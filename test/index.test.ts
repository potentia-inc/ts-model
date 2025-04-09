import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { ConflictError, NotFoundError } from '../src/error.js'
import {
  Filter,
  InsertionOf,
  Model,
  ModelOrId,
  Models,
  UUID_DOC_SCHEMA,
  UpdateFilter,
  UuidDoc,
  pickIdOrNil,
  toExistsOrNil,
  toUnsetOrNil,
  toValueOrAbsent,
  toValueOrInOrNil,
} from '../src/model.js'
import { Connection } from '../src/mongo.js'
import { Nil, isNullish, toUuid } from '../src/type.js'

const { MONGO_URI } = process.env
assert(!isNullish(MONGO_URI))
export const CONNECTION = new Connection(MONGO_URI)

const TEST_NAME = 'tests'

type TestDoc = UuidDoc & {
  foo: string
  bar?: number
}

class Test extends Model<TestDoc> {
  foo: string
  bar?: number

  constructor(doc: TestDoc) {
    super(doc)

    this.foo = doc.foo
    this.bar = doc.bar
  }
}

type TestId = Test['id']
type TestOrId = ModelOrId<TestDoc, Test>

const TEST_SCHEMA = {
  name: TEST_NAME,
  validator: {
    $jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['_id', 'foo', 'created_at'],
      properties: {
        ...UUID_DOC_SCHEMA,
        foo: { type: 'string' },
        bar: { type: 'number' },
      },
    },
  },
  indexes: {
    create_index: { keys: { created_at: 1 } },
    foo_unique: { keys: { foo: 1 }, options: { unique: true } },
  },
}

type TestQuery = {
  id?: TestOrId
  foo?: string
  bar?: number
}
type TestInsert = {
  id?: TestId
  foo: string
  bar?: number
}
type TestUpdate = {
  foo?: string
  bar?: number
}

class Tests extends Models<TestDoc, Test, TestQuery, TestInsert, TestUpdate> {
  get name(): string {
    return TEST_NAME
  }

  $model(doc: TestDoc): Test {
    return new Test(doc)
  }

  $query(query: TestQuery): Filter<TestDoc> {
    return { _id: pickIdOrNil(query.id), foo: query.foo, bar: query.bar }
  }

  $insert(values: TestInsert): InsertionOf<TestDoc> {
    const _id = values.id ?? toUuid()
    return { _id, foo: values.foo, bar: values.bar }
  }

  $set(values: TestUpdate): UpdateFilter<TestDoc> {
    return { foo: values.foo, bar: values.bar }
  }

  $unset(values: TestUpdate): UpdateFilter<TestDoc> {
    return { bar: toUnsetOrNil(values, 'bar') }
  }
}

beforeAll(async () => {
  await CONNECTION.connect()

  await CONNECTION.migrate(TEST_SCHEMA)
})

afterAll(async () => {
  await CONNECTION.disconnect()
})

describe('model', () => {
  const TESTS = new Tests({ connection: CONNECTION })

  test('CRUD for tests', async () => {
    const foo = randStr()
    const foo2 = randStr()

    // insertOne and insertMany
    const test = await TESTS.insertOne({ foo })
    expect(test).toMatchObject({
      id: expect.toBeUuid(),
      foo,
      createdAt: expect.toBeDate(),
    })
    await expect(() =>
      TESTS.insertOne({ id: test.id, foo: foo2 }),
    ).rejects.toThrow(ConflictError)
    await expect(() => TESTS.insertOne({ foo })).rejects.toThrow(ConflictError)
    expect(await TESTS.insertMany([{ foo: foo2 }])).toMatchObject([
      {
        id: expect.toBeUuid(),
        foo: foo2,
        createdAt: expect.toBeDate(),
      },
    ])
    await expect(() => TESTS.insertMany([{ foo: foo2 }])).rejects.toThrow(
      ConflictError,
    )

    // find, findOne, findMany
    expect(await TESTS.find(test)).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    expect(await TESTS.find(test.id)).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    await expect(() => TESTS.find(toUuid())).rejects.toThrow(NotFoundError)
    expect(await TESTS.findOne({ id: test })).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    expect(await TESTS.findOne({ id: test.id })).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    const pagination = {
      skip: 0,
      limit: 100,
      sort: { created_at: 1 },
    } as const
    expect(await TESTS.findMany({}, pagination)).toMatchObject([
      {
        id: expect.toBeUuid(),
        foo: expect.any(String),
        createdAt: expect.toBeDate(),
      },
      {
        id: expect.toBeUuid(),
        foo: expect.any(String),
        createdAt: expect.toBeDate(),
      },
    ])

    // count, iterate, paginate
    expect(await TESTS.count({})).toBe(2)
    for await (const test of TESTS.iterate({}, pagination)) {
      expect(test).toMatchObject({
        id: expect.toBeUuid(),
        foo: expect.any(String),
        createdAt: expect.toBeDate(),
      })
    }

    // findManyToMapBy
    const map = await TESTS.findManyToMapBy((x) => String(x.id), {}, pagination)
    expect(map.size).toBe(2)
    expect(map.get(String(test.id))).toMatchObject(test)

    const begin = new Date(Date.now() - 86400000)
    const end = new Date(Date.now() + 86400000)
    expect(
      await TESTS.paginate(
        {},
        {
          offset: 0,
          limit: 100,
          key: 'created_at',
          order: 'asc',
          begin,
          end,
        },
      ),
    ).toMatchObject([
      {
        offset: 0,
        limit: 100,
        count: 2,
        order: 'asc',
        key: 'created_at',
        begin: expect.toEqualDate(begin),
        end: expect.toEqualDate(end),
      },
      [
        {
          id: expect.toBeUuid(),
          foo: expect.any(String),
          createdAt: expect.toBeDate(),
        },
        {
          id: expect.toBeUuid(),
          foo: expect.any(String),
          createdAt: expect.toBeDate(),
        },
      ],
    ])

    // updateOne, updateMany
    await expect(() => TESTS.updateOne(toUuid(), { bar: 123 })).rejects.toThrow(
      NotFoundError,
    )
    expect(await TESTS.updateOne(test, { bar: 123 })).toMatchObject({
      id: test.id,
      foo: test.foo,
      bar: 123,
      createdAt: expect.toEqualDate(test.createdAt),
      updatedAt: expect.toBeDate(),
    })
    expect(await TESTS.updateOne(test, { bar: Nil })).toMatchObject({
      id: test.id,
      foo: test.foo,
      bar: Nil,
      createdAt: expect.toEqualDate(test.createdAt),
      updatedAt: expect.toBeDate(),
    })
    expect(await TESTS.updateMany({ foo: foo2 }, { bar: 456 })).toBe(1)
    expect(await TESTS.updateMany({ foo: randStr() }, { bar: 789 })).toBe(0)

    // deleteOne, deleteMany
    await expect(() => TESTS.deleteOne(toUuid())).rejects.toThrow(NotFoundError)
    await TESTS.deleteOne(test)
    expect(await TESTS.findOne({ id: test })).toBeNil()
    await expect(() => TESTS.deleteOne(test)).rejects.toThrow(NotFoundError)
    expect(await TESTS.deleteMany({})).toBe(1)
    expect(await TESTS.deleteMany({})).toBe(0)
  })

  test('utilities', () => {
    expect(toValueOrAbsent(Nil)).toMatchObject({ $exists: false })
    expect(toValueOrAbsent(null)).toMatchObject({ $exists: false })
    expect(toValueOrAbsent(true)).toBe(true)
    expect(toValueOrAbsent(false)).toBe(false)
    expect(toValueOrAbsent(123)).toBe(123)
    expect(toValueOrAbsent('foo')).toBe('foo')
    expect(toValueOrAbsent([0, 1])).toMatchObject([0, 1])
    expect(toValueOrAbsent({ foo: 'bar' })).toMatchObject({ foo: 'bar' })

    expect(toExistsOrNil(Nil)).toBe(Nil)
    expect(toExistsOrNil(null)).toBe(Nil)
    expect(toExistsOrNil(true)).toMatchObject({ $exists: true })
    expect(toExistsOrNil(false)).toMatchObject({ $exists: false })

    expect(toUnsetOrNil<{ foo?: unknown }>({}, 'foo')).toBe(Nil)
    expect(toUnsetOrNil({ foo: 'bar' }, 'foo')).toBe(Nil)
    expect(toUnsetOrNil({ foo: Nil }, 'foo')).toBe(true)
    expect(toUnsetOrNil({ foo: null }, 'foo')).toBe(true)

    expect(toValueOrInOrNil(Nil)).toBe(Nil)
    expect(toValueOrInOrNil(null)).toBe(Nil)
    expect(toValueOrInOrNil('foo')).toBe('foo')
    expect(toValueOrInOrNil(['foo', 'bar'])).toMatchObject({
      $in: ['foo', 'bar'],
    })
    expect(toValueOrInOrNil(['foo', 'bar'], (x) => x.length)).toMatchObject({
      $in: [3, 3],
    })
  })
})

function randStr(length = 8): string {
  assert(Number.isInteger(length) && length > 0)
  return randomBytes(length / 2)
    .toString('base64')
    .substring(0, length)
}
