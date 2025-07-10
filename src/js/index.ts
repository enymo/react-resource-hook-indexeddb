import type { Resource, ResourceBackendAdapter } from "@enymo/react-resource-hook";
import Dexie, { EntityTable, Transaction } from "dexie";
import { useMemo } from "react";
import { v4 as uuidv4 } from "uuid";

export default function createIndexedDBResourceAdapter({
    databaseName,
    generateUuids,
    schema
}: {
    databaseName: string,
    generateUuids?: boolean,
    schema: {
        version: number,
        schema: {[table: string]: string},
        upgrade?: (trans: Transaction) => PromiseLike<any> | void
    }[]
}): ResourceBackendAdapter<{}, {}, never, never> {
    const db = new Dexie(databaseName) as Dexie & {
        [table: string]: EntityTable<Resource, "id">
    };

    for (const entry of schema) {
        const version = db.version(entry.version).stores(entry.schema);
        if (entry.upgrade !== undefined) {
            version.upgrade(entry.upgrade);
        }
    }

    return resource => ({
        actionHook: () => useMemo(() => ({
            store: async data => {
                const insert = {
                    ...data,
                    id: generateUuids ? uuidv4() : data.id
                };
                await db[resource].add(insert);
                return insert;               
            },
            batchStore: async data => {
                await Promise.all(data.map(item => db[resource].add({
                    ...item,
                    id: generateUuids ? uuidv4 : item.id
                })));
                return data;
            },
            update: async (id, data) => {
                await db[resource].update(id, data);
                return db[resource].get(id);
            },
            batchUpdate: async data => {
                await Promise.all(data.map(item => {
                    const {id, ...rest} = item;
                    return db[resource].update(id, rest);
                }));
                return db[resource].where("id").anyOf(data.map(item => item.id)).toArray();
            },
            destroy: async id => {
                await db[resource].delete(id)
            },
            batchDestroy: async ids => {
                await Promise.all(ids.map(id => db[resource].delete(id)))
            },
            query: () => {
                throw new Error("Method not supported")
            },
            refresh: async id => ({
                data: await (id !== undefined ? db[resource].get(id) : db[resource].toArray()) as any,
                meta: undefined as any,
                error: null
            })
        }), [resource]),
        eventHook: () => {}
    })
}