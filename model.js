import assert from 'node:assert';
import { ConflictError, NotFoundError, UnacknowledgedError } from './error.js';
import { isDuplicationError, } from './mongo.js';
import { ObjectId, Uuid, Nil, isNullish } from './type.js';
export { isDuplicationError } from './mongo.js';
export const TIMESTAMP_SCHEMA = {
    created_at: { bsonType: 'date' },
    updated_at: { bsonType: 'date' },
};
export const NUMBER_DOC_SCHEMA = {
    _id: { type: 'number' },
    ...TIMESTAMP_SCHEMA,
};
export const STRING_DOC_SCHEMA = {
    _id: { type: 'string' },
    ...TIMESTAMP_SCHEMA,
};
export const UUID_DOC_SCHEMA = {
    _id: { bsonType: 'binData' },
    ...TIMESTAMP_SCHEMA,
};
export const OBJECTID_DOC_SCHEMA = {
    _id: { bsonType: 'binData' },
    ...TIMESTAMP_SCHEMA,
};
export class Model {
    id;
    createdAt;
    updatedAt;
    constructor(doc) {
        this.id = doc._id;
        this.createdAt = doc.created_at;
        this.updatedAt = doc.updated_at;
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pickId(x) {
    return typeof x === 'number' || typeof x === 'string' || x instanceof Uuid
        ? x
        : x.id;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pickIdOrNil(x) {
    return isNullish(x) ? Nil : pickId(x);
}
export class Models {
    connection;
    constructor(options) {
        this.connection = options.connection;
    }
    get collection() {
        return this.connection.db.collection(this.name, {
            ignoreUndefined: true,
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    $query(query, options) {
        return {};
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    $inc(values, options) {
        return {};
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    $set(values, options) {
        return {};
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    $unset(values, options) {
        return {};
    }
    async find(id, options = {}) {
        const _id = modelsPickId(id);
        if (_id !== id)
            return id;
        const found = await this.collection.findOne({ _id }, options);
        if (isNullish(found))
            throw new NotFoundError(`Not Found: ${this.name}`);
        return this.$model(found, options);
    }
    async findOne(query, options = {}) {
        const found = await this.collection.findOne(this.$query(query, options), options);
        return isNullish(found) ? Nil : this.$model(found, options);
    }
    async findMany(query, pagination = {}, options = {}) {
        const cursor = this.collection.find(this.$query(query, options), options);
        const { sort, offset, limit } = pagination;
        if (!isNullish(sort))
            cursor.sort(sort);
        if (!isNullish(offset))
            cursor.skip(offset);
        if (!isNullish(limit))
            cursor.limit(limit);
        const found = await cursor.toArray();
        return found.map((x) => this.$model(x, options));
    }
    async paginate(query, pagination = {}, options = {}) {
        const [paginated, found] = await paginate(this.collection, this.$query(query, options), pagination, options);
        return [paginated, found.map((x) => this.$model(x, options))];
    }
    iterate(query, sort = { created_at: 1 }, options = {}) {
        const cursor = this.collection
            .find(this.$query(query, options), options)
            .sort(sort);
        return new Cursor((x) => this.$model(x, options), cursor);
    }
    async count(query, options = {}) {
        return await this.collection.countDocuments(this.$query(query, options), options);
    }
    async insertOne(values, options = {}) {
        try {
            const $options = { ...options, $now: options.$now ?? new Date() };
            const inserted = {
                created_at: $options.$now,
                ...this.$insert(values, $options),
            };
            const { acknowledged } = await this.collection.insertOne(inserted, $options);
            if (acknowledged)
                return this.$model(inserted, $options);
        }
        catch (err) {
            throw isDuplicationError(err)
                ? new ConflictError(`Conflict: ${this.name}`)
                : err;
        }
        throw new UnacknowledgedError();
    }
    async insertMany(values, options = {}) {
        if (values.length === 0)
            return [];
        try {
            const $options = { ...options, $now: options.$now ?? new Date() };
            const inserted = values.map((x) => ({
                created_at: $options.$now,
                ...this.$insert(x, $options),
            }));
            const { acknowledged } = await this.collection.insertMany(inserted, $options);
            if (acknowledged)
                return inserted.map((x) => this.$model(x, $options));
        }
        catch (err) {
            throw isDuplicationError(err)
                ? new ConflictError(`Conflict: ${this.name}`)
                : err;
        }
        throw new UnacknowledgedError();
    }
    async updateOne(id, values, options = {}) {
        const $options = { ...options, $now: options.$now ?? new Date() };
        const updated = await this.collection.findOneAndUpdate({ _id: modelsPickId(id) }, {
            $inc: this.$inc(values, $options),
            $set: { updated_at: $options.$now, ...this.$set(values, $options) },
            $unset: this.$unset(values, $options),
        }, { returnDocument: 'after', ...$options });
        if (isNullish(updated))
            throw new NotFoundError(`Not Found: ${this.name}`);
        return this.$model(updated, $options);
    }
    async updateMany(query, values, options = {}) {
        const $options = { ...options, $now: options.$now ?? new Date() };
        const { modifiedCount } = await this.collection.updateMany(this.$query(query, $options), {
            $inc: this.$inc(values, $options),
            $set: { updated_at: $options.$now, ...this.$set(values, $options) },
            $unset: this.$unset(values, $options),
        }, $options);
        return modifiedCount;
    }
    async deleteOne(id, options = {}) {
        const { deletedCount } = await this.collection.deleteOne({ _id: modelsPickId(id) }, options);
        if (deletedCount !== 1)
            throw new NotFoundError(`Not Found: ${this.name}`);
    }
    async deleteMany(query, options = {}) {
        const { deletedCount } = await this.collection.deleteMany(this.$query(query, options), options);
        return deletedCount;
    }
}
export class Cursor {
    #map;
    #cursor;
    constructor(map, cursor) {
        this.#map = map;
        this.#cursor = cursor;
    }
    [Symbol.asyncIterator]() {
        return {
            next: async () => await this.#cursor
                .next()
                .then((value) => value == null
                ? { value: Nil, done: true }
                : { value: this.#map(value), done: false }),
        };
    }
}
export const PAGINATION_ORDERS = ['asc', 'desc'];
export async function paginate(collection, query, pagination = {}, options = {}) {
    const max = 1000;
    const { offset = 0, order = 'asc', key = 'created_at', begin, end, } = pagination;
    const limit = Math.min(pagination.limit ?? max, max);
    assert(offset >= 0 && Number.isInteger(offset));
    assert(limit >= 0 && limit <= max && Number.isInteger(limit));
    assert(!isNullish(order));
    const filter = {
        ...query,
        ...(isNullish(begin) && isNullish(end)
            ? {}
            : { [key]: { $gte: begin, $lt: end } }),
    };
    const count = await collection.countDocuments(filter, options);
    const cursor = collection.find(filter, options);
    const docs = await cursor
        .sort({ [key]: order === 'asc' ? 1 : -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
    return [{ offset, limit, key, order, count, begin, end }, docs];
}
function modelsPickId(x) {
    return typeof x === 'number' ||
        typeof x === 'string' ||
        x instanceof ObjectId ||
        x instanceof Uuid
        ? x
        : x.id;
}
export function valueOrAbsent(value) {
    return isNullish(value) ? { $exists: false } : value;
}
export function existsOrNil($exists) {
    return isNullish($exists) ? Nil : { $exists };
}
export function unsetOrNil(values, key) {
    return key in values && isNullish(values[key]) ? true : Nil;
}
export function queryIn(x, map = (x) => x) {
    if (isNullish(x))
        return Nil;
    if (Array.isArray(x))
        return { $in: x.map(map) };
    return map(x);
}
//# sourceMappingURL=model.js.map