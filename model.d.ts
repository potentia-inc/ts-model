import { Collection, CommandOperationOptions, Connection, Filter, FindCursor, OptionalUnlessRequiredId, Sort, UpdateFilter, WithId } from './mongo.js';
import { ObjectId, Uuid, Nil, TypeOrNil } from './type.js';
export { Filter, WithId, UpdateFilter, isDuplicationError } from './mongo.js';
export type Timestamp = {
    created_at: Date;
    updated_at?: Date;
};
export declare const TIMESTAMP_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
};
export type NumberDoc = {
    _id: number;
} & Timestamp;
export declare const NUMBER_DOC_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
    _id: {
        type: string;
    };
};
export type StringDoc = {
    _id: string;
} & Timestamp;
export declare const STRING_DOC_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
    _id: {
        type: string;
    };
};
export type UuidDoc = {
    _id: Uuid;
} & Timestamp;
export declare const UUID_DOC_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
    _id: {
        bsonType: string;
    };
};
export type ObjectIdDoc = {
    _id: ObjectId;
} & Timestamp;
export declare const OBJECTID_DOC_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
    _id: {
        bsonType: string;
    };
};
export declare class Model<D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc> {
    id: D['_id'];
    createdAt: Date;
    updatedAt?: Date;
    constructor(doc: D);
}
export type ModelOrId<D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc, M extends Model<D>> = M | M['id'];
export declare function pickId(x: number | Model<NumberDoc>): number;
export declare function pickId(x: string | Model<StringDoc>): string;
export declare function pickId(x: ObjectId | Model<ObjectIdDoc>): ObjectId;
export declare function pickId(x: Uuid | Model<UuidDoc>): Uuid;
export declare function pickIdOrNil(x?: number | Model<NumberDoc>): number | Nil;
export declare function pickIdOrNil(x?: string | Model<StringDoc>): string | Nil;
export declare function pickIdOrNil(x?: ObjectId | Model<ObjectIdDoc>): ObjectId | Nil;
export declare function pickIdOrNil(x?: Uuid | Model<UuidDoc>): Uuid | Nil;
export type Options = CommandOperationOptions & {
    $now?: Date;
};
export declare abstract class Models<D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc, M extends Model<D>, Q, I, U> {
    readonly connection: Connection;
    constructor(options: {
        connection: Connection;
    });
    get collection(): Collection<D>;
    abstract get name(): string;
    abstract $model(doc: D | WithId<D> | OptionalUnlessRequiredId<D>, options?: Options): M;
    abstract $insert(values: I, options?: Options): Omit<D, 'created_at'>;
    $query(query: Q, options?: Options): Filter<D>;
    $inc(values: U, options?: Options): UpdateFilter<D>;
    $set(values: U, options?: Options): UpdateFilter<D>;
    $unset(values: U, options?: Options): UpdateFilter<D>;
    find(id: ModelOrId<D, M>, options?: Options): Promise<M>;
    findOne(query: Q, options?: Options): Promise<TypeOrNil<M>>;
    findMany(query: Q, pagination?: {
        sort?: Sort;
        offset?: number;
        limit?: number;
    }, options?: Options): Promise<M[]>;
    paginate(query: Q, pagination?: Partial<Pagination>, options?: Options): Promise<[Pagination, M[]]>;
    iterate(query: Q, sort?: Sort, options?: Options): Cursor<D, M>;
    count(query: Q, options?: Options): Promise<number>;
    insertOne(values: I, options?: Options): Promise<M>;
    insertMany(values: I[], options?: Options): Promise<M[]>;
    updateOne(id: ModelOrId<D, M>, values: U, options?: Options): Promise<M>;
    updateMany(query: Q, values: U, options?: Options): Promise<number>;
    deleteOne(id: ModelOrId<D, M>, options?: Options): Promise<void>;
    deleteMany(query: Q, options?: Options): Promise<number>;
}
export declare class Cursor<D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc, M extends Model<D>> {
    #private;
    constructor(map: (d: D | WithId<D>) => M, cursor: FindCursor<WithId<D>>);
    [Symbol.asyncIterator](): AsyncIterator<M, void>;
}
export declare const PAGINATION_ORDERS: readonly ["asc", "desc"];
export type PaginationOrder = (typeof PAGINATION_ORDERS)[number];
export type Pagination = {
    offset: number;
    limit: number;
    count: number;
    key: string;
    order: PaginationOrder;
    begin?: Date;
    end?: Date;
};
export declare function paginate<D extends NumberDoc | StringDoc | ObjectIdDoc | UuidDoc>(collection: Collection<D>, query: Filter<D>, pagination?: Partial<Pagination>, options?: Options): Promise<[Pagination, WithId<D>[]]>;
export type InsertionOf<T> = Omit<T, 'created_at'>;
export declare function valueOrAbsent<T>(value?: T | null): T | {
    $exists: boolean;
};
export declare function existsOrNil($exists?: boolean | null): {
    $exists: boolean;
} | Nil;
export declare function unsetOrNil<T extends object>(values: T, key: keyof T): true | Nil;
export declare function queryIn<S, T = S>(x: Nil | null | S | S[], map?: (x: S) => T): T | {
    $in: T[];
} | Nil;
