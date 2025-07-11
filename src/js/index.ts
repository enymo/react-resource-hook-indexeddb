import type { Delta, DeltaResourceBackendAdapter, Resource } from "@enymo/react-resource-hook";
import Dexie, { EntityTable, Transaction } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback } from "react";

const methodNotSupported = () => {
    throw new Error("Method not supported");
}

export default function createIndexedDBResourceAdapter({
    databaseName,
    schema
}: {
    databaseName: string,
    schema: {
        version: number,
        schema: {[table: string]: string},
        upgrade?: (trans: Transaction) => PromiseLike<any> | void
    }[]
}): DeltaResourceBackendAdapter<{}, {}, never, never> {
    const db = new Dexie(databaseName) as Dexie & {
        [table: string]: EntityTable<Resource, "id">
    };
    const deltaDb = new Dexie(`${databaseName}--deltas`) as Dexie & {
        deltas: EntityTable<Delta<Resource> & {
            resource: string
        }, any>
    };
    
    deltaDb.version(1).stores({
        deltas: "[resource+id]"
    });

    for (const entry of schema) {
        const version = db.version(entry.version).stores(entry.schema);
        if (entry.upgrade !== undefined) {
            version.upgrade(entry.upgrade);
        }
    }

    return resource => ({
        actionHook: () => ({
            store: useCallback(async data => {
                await db[resource].add(data);
                return data;               
            }, [resource]),
            batchStore: useCallback(async data => {
                await Promise.all(data.map(item => db[resource].add(item)));
                return data;
            }, [resource]),
            update: useCallback(async (id, data) => {
                await db[resource].update(id, data);
                return db[resource].get(id) as any;
            }, [resource]),
            batchUpdate: useCallback(async data => {
                await Promise.all(data.map(item => {
                    const {id, ...rest} = item;
                    return db[resource].update(id, rest);
                }));
                return db[resource].where("id").anyOf(data.map(item => item.id)).toArray() as any;
            }, [resource]),
            destroy: useCallback(async id => {
                await db[resource].delete(id)
            }, [resource]),
            batchDestroy: useCallback(async ids => {
                await Promise.all(ids.map(id => db[resource].delete(id)))
            }, [resource]),
            query: methodNotSupported,
            refresh: useCallback(async id => ({
                data: await (id !== undefined ? db[resource].get(id) : db[resource].toArray()) as any,
                meta: undefined as any,
                error: null
            }), [resource]),
            deltas: useLiveQuery(() => deltaDb.deltas.where("resource").equals(resource).toArray() as any, [resource]),
            writeDelta: useCallback(delta => deltaDb.deltas.put({
                ...delta,
                resource
            }), [resource]),
            flushDelta: useCallback(id => deltaDb.deltas.delete([resource, id]), [resource]),
            offline: false
        }),
        eventHook: () => {}
    })
}