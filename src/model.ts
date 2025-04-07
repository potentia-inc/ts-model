import assert from 'node:assert'
import { ConflictError, NotFoundError, UnacknowledgedError } from './error.js'
import {
  Collection,
  CommandOperationOptions,
  Connection,
  Filter,
  FindCursor,
  isDuplicationError,
  OptionalUnlessRequiredId,
  Sort,
  UpdateFilter,
  WithId,
} from './mongo.js'
import { ObjectId, Uuid, Nil, TypeOrNil, isNullish } from './type.js'

export { Filter, WithId, UpdateFilter, isDuplicationError } from './mongo.js'

export type Timestamp = {
  created_at: Date
  updated_at?: Date
}

export const TIMESTAMP_SCHEMA = {
  created_at: { bsonType: 'date' },
  updated_at: { bsonType: 'date' },
}

export type NumberDoc = { _id: number } & Timestamp
export const NUMBER_DOC_SCHEMA = {
  _id: { type: 'number' },
  ...TIMESTAMP_SCHEMA,
}

export type StringDoc = { _id: string } & Timestamp
export const STRING_DOC_SCHEMA = {
  _id: { type: 'string' },
  ...TIMESTAMP_SCHEMA,
}

export type UuidDoc = { _id: Uuid } & Timestamp
export const UUID_DOC_SCHEMA = {
  _id: { bsonType: 'binData' },
  ...TIMESTAMP_SCHEMA,
}

export type ObjectIdDoc = { _id: ObjectId } & Timestamp
export const OBJECTID_DOC_SCHEMA = {
  _id: { bsonType: 'binData' },
  ...TIMESTAMP_SCHEMA,
}

export class Model<D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc> {
  id: D['_id']
  createdAt: Date
  updatedAt?: Date

  constructor(doc: D) {
    this.id = doc._id
    this.createdAt = doc.created_at
    this.updatedAt = doc.updated_at
  }
}

export type ModelOrId<
  D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc,
  M extends Model<D>,
> = M | M['id']

export function pickId(x: number | Model<NumberDoc>): number
export function pickId(x: string | Model<StringDoc>): string
export function pickId(x: ObjectId | Model<ObjectIdDoc>): ObjectId
export function pickId(x: Uuid | Model<UuidDoc>): Uuid
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pickId(x: any): any {
  return typeof x === 'number' || typeof x === 'string' || x instanceof Uuid
    ? x
    : x.id
}

export function pickIdOrNil(x?: number | Model<NumberDoc>): number | Nil
export function pickIdOrNil(x?: string | Model<StringDoc>): string | Nil
export function pickIdOrNil(x?: ObjectId | Model<ObjectIdDoc>): ObjectId | Nil
export function pickIdOrNil(x?: Uuid | Model<UuidDoc>): Uuid | Nil
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pickIdOrNil(x?: any): any {
  return isNullish(x) ? Nil : pickId(x)
}

export type Options = CommandOperationOptions & { $now?: Date }

export abstract class Models<
  D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc,
  M extends Model<D>,
  Q,
  I,
  U,
> {
  readonly connection: Connection

  constructor(options: { connection: Connection }) {
    this.connection = options.connection
  }

  get collection(): Collection<D> {
    return this.connection.db.collection<D>(this.name, {
      ignoreUndefined: true,
    })
  }

  abstract get name(): string
  abstract $model(
    doc: D | WithId<D> | OptionalUnlessRequiredId<D>,
    options?: Options,
  ): M
  abstract $insert(values: I, options?: Options): Omit<D, 'created_at'>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $query(query: Q, options?: Options): Filter<D> {
    return {}
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $inc(values: U, options?: Options): UpdateFilter<D> {
    return {}
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $set(values: U, options?: Options): UpdateFilter<D> {
    return {}
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $unset(values: U, options?: Options): UpdateFilter<D> {
    return {}
  }

  async find(id: ModelOrId<D, M>, options: Options = {}): Promise<M> {
    const _id = modelsPickId(id)
    if (_id !== id) return id as M
    const found = await this.collection.findOne({ _id } as Filter<D>, options)
    if (isNullish(found)) throw new NotFoundError(`Not Found: ${this.name}`)
    return this.$model(found, options)
  }

  async findOne(query: Q, options: Options = {}): Promise<TypeOrNil<M>> {
    const found = await this.collection.findOne(
      this.$query(query, options),
      options,
    )
    return isNullish(found) ? Nil : this.$model(found, options)
  }

  async findMany(
    query: Q,
    pagination: {
      sort?: Sort
      offset?: number
      limit?: number
    } = {},
    options: Options = {},
  ): Promise<M[]> {
    const cursor = this.collection.find(this.$query(query, options), options)
    const { sort, offset, limit } = pagination
    if (!isNullish(sort)) cursor.sort(sort)
    if (!isNullish(offset)) cursor.skip(offset)
    if (!isNullish(limit)) cursor.limit(limit)
    const found = await cursor.toArray()
    return found.map((x) => this.$model(x, options))
  }

  async paginate(
    query: Q,
    pagination: Partial<Pagination> = {},
    options: Options = {},
  ): Promise<[Pagination, M[]]> {
    const [paginated, found] = await paginate(
      this.collection,
      this.$query(query, options),
      pagination,
      options,
    )
    return [paginated, found.map((x) => this.$model(x, options))]
  }

  iterate(
    query: Q,
    sort: Sort = { created_at: 1 },
    options: Options = {},
  ): Cursor<D, M> {
    const cursor = this.collection
      .find(this.$query(query, options), options)
      .sort(sort)
    return new Cursor<D, M>((x) => this.$model(x, options), cursor)
  }

  async count(query: Q, options: Options = {}): Promise<number> {
    return await this.collection.countDocuments(
      this.$query(query, options),
      options,
    )
  }

  async insertOne(values: I, options: Options = {}): Promise<M> {
    try {
      const $options = { ...options, $now: options.$now ?? new Date() }
      const inserted = {
        created_at: $options.$now,
        ...this.$insert(values, $options),
      } as OptionalUnlessRequiredId<D>
      const { acknowledged } = await this.collection.insertOne(
        inserted,
        $options,
      )
      if (acknowledged) return this.$model(inserted, $options)
    } catch (err) {
      throw isDuplicationError(err)
        ? new ConflictError(`Conflict: ${this.name}`)
        : err
    }
    throw new UnacknowledgedError()
  }

  async insertMany(values: I[], options: Options = {}): Promise<M[]> {
    if (values.length === 0) return []
    try {
      const $options = { ...options, $now: options.$now ?? new Date() }
      const inserted = values.map((x) => ({
        created_at: $options.$now,
        ...this.$insert(x, $options),
      })) as OptionalUnlessRequiredId<D>[]
      const { acknowledged } = await this.collection.insertMany(
        inserted,
        $options,
      )
      if (acknowledged) return inserted.map((x) => this.$model(x, $options))
    } catch (err) {
      throw isDuplicationError(err)
        ? new ConflictError(`Conflict: ${this.name}`)
        : err
    }
    throw new UnacknowledgedError()
  }

  async updateOne(
    id: ModelOrId<D, M>,
    values: U,
    options: Options = {},
  ): Promise<M> {
    const $options = { ...options, $now: options.$now ?? new Date() }
    const updated = await this.collection.findOneAndUpdate(
      { _id: modelsPickId(id) } as Filter<D>,
      {
        $inc: this.$inc(values, $options),
        $set: { updated_at: $options.$now, ...this.$set(values, $options) },
        $unset: this.$unset(values, $options),
      } as UpdateFilter<D>,
      { returnDocument: 'after', ...$options },
    )
    if (isNullish(updated)) throw new NotFoundError(`Not Found: ${this.name}`)
    return this.$model(updated, $options)
  }

  async updateMany(
    query: Q,
    values: U,
    options: Options = {},
  ): Promise<number> {
    const $options = { ...options, $now: options.$now ?? new Date() }
    const { modifiedCount } = await this.collection.updateMany(
      this.$query(query, $options),
      {
        $inc: this.$inc(values, $options),
        $set: { updated_at: $options.$now, ...this.$set(values, $options) },
        $unset: this.$unset(values, $options),
      } as UpdateFilter<D>,
      $options,
    )
    return modifiedCount
  }

  async deleteOne(id: ModelOrId<D, M>, options: Options = {}): Promise<void> {
    const { deletedCount } = await this.collection.deleteOne(
      { _id: modelsPickId(id) } as Filter<D>,
      options,
    )
    if (deletedCount !== 1) throw new NotFoundError(`Not Found: ${this.name}`)
  }

  async deleteMany(query: Q, options: Options = {}): Promise<number> {
    const { deletedCount } = await this.collection.deleteMany(
      this.$query(query, options),
      options,
    )
    return deletedCount
  }
}

export class Cursor<
  D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc,
  M extends Model<D>,
> {
  #map: (d: D | WithId<D>) => M
  #cursor: FindCursor<WithId<D>>

  constructor(map: (d: D | WithId<D>) => M, cursor: FindCursor<WithId<D>>) {
    this.#map = map
    this.#cursor = cursor
  }

  [Symbol.asyncIterator](): AsyncIterator<M, void> {
    return {
      next: async () =>
        await this.#cursor
          .next()
          .then((value) =>
            value == null
              ? { value: Nil, done: true }
              : { value: this.#map(value), done: false },
          ),
    }
  }
}

export const PAGINATION_ORDERS = ['asc', 'desc'] as const
export type PaginationOrder = (typeof PAGINATION_ORDERS)[number]
export type Pagination = {
  offset: number
  limit: number
  count: number
  key: string
  order: PaginationOrder
  begin?: Date
  end?: Date
}

export async function paginate<
  D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc,
>(
  collection: Collection<D>,
  query: Filter<D>,
  pagination: Partial<Pagination> = {},
  options: Options = {},
): Promise<[Pagination, WithId<D>[]]> {
  const max = 1000
  const {
    offset = 0,
    order = 'asc',
    key = 'created_at',
    begin,
    end,
  } = pagination
  const limit = Math.min(pagination.limit ?? max, max)
  assert(offset >= 0 && Number.isInteger(offset))
  assert(limit >= 0 && limit <= max && Number.isInteger(limit))
  assert(!isNullish(order))
  const filter: Filter<D> = {
    ...query,
    ...(isNullish(begin) && isNullish(end)
      ? {}
      : { [key]: { $gte: begin, $lt: end } }),
  }
  const count = await collection.countDocuments(filter, options)
  const cursor = collection.find(filter, options)
  const docs = await cursor
    .sort({ [key]: order === 'asc' ? 1 : -1 })
    .skip(offset)
    .limit(limit)
    .toArray()
  return [{ offset, limit, key, order, count, begin, end }, docs]
}

function modelsPickId<
  D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc,
  M extends Model<D>,
>(x: M | M['id']): M['id'] {
  return typeof x === 'number' ||
    typeof x === 'string' ||
    x instanceof ObjectId ||
    x instanceof Uuid
    ? x
    : x.id
}

export type InsertionOf<T> = Omit<T, 'created_at'>

export function valueOrAbsent<T>(value?: T | null) {
  return isNullish(value) ? { $exists: false } : value
}

export function existsOrNil(
  $exists?: boolean | null,
): { $exists: boolean } | Nil {
  return isNullish($exists) ? Nil : { $exists }
}

export function unsetOrNil<T extends object>(
  values: T,
  key: keyof T,
): true | Nil {
  return key in values && isNullish(values[key]) ? true : Nil
}

export function queryIn<S, T = S>(
  x: Nil | null | S | S[],
  map: (x: S) => T = (x: S) => x as unknown as T,
): T | { $in: T[] } | Nil {
  if (isNullish(x)) return Nil
  if (Array.isArray(x)) return { $in: x.map(map) }
  return map(x as S)
}
