import type { CacheResourceBackendAdapter, Resource } from "@enymo/react-resource-hook";
import Dexie, { Table, Transaction } from "dexie";

const methodNotSupported = () => {
    throw new Error("Method not supported");
}

export default function createIndexedDBResourceAdapter({
    databaseName
}: {
    databaseName: string
}): CacheResourceBackendAdapter<{
    schema: {
        version: number,
        schema?: string,
        upgrade?: (trans: Transaction) => PromiseLike<any> | void
    }[]
}, {}, never> {
    const db = new Dexie(databaseName) as Dexie & {
        [resource: string]: Table<{
            id: Resource["id"],
            key: string,
            target: "local" | "remote",
            resource: Resource | null
        }, [string, "local" | "remote", string | number]>
    };

    return (resource, {
        schema = []
    }, cache) => {
        if (schema.length > 0) {
            for (const entry of schema) {
                const version = db.version(entry.version).stores({
                    [resource]: `[key+target+id],id${entry.schema?.split(",").map(part => `,resource.${part.trim()}`).join("") ?? ""}`
                })
                if (entry.upgrade) {
                    version.upgrade(entry.upgrade);
                }
            }
        }
        else {
            db.version(1).stores({
                [resource]: "[key+target+id],id"
            });
        }

        return {
            actionHook: ({}, params) => {
                const key = JSON.stringify(params);
                return {
                    store: async data => {
                        const promises = [
                            db[resource].add({
                                key,
                                id: data.id,
                                resource: data,
                                target: "local"
                            })
                        ];
                        if (cache) {
                            promises.push(db[resource].add({
                                key,
                                id: data.id,
                                resource: null,
                                target: "remote"
                            }))
                        }
                        await Promise.all(promises);
                        return data;               
                    },
                    batchStore: async data => {
                        await Promise.all(data.flatMap(item => {
                            const promises = [
                                db[resource].add({
                                    key,
                                    id: item.id,
                                    resource: item,
                                    target: "local"
                                })
                            ];
                            if (cache) {
                                promises.push(db[resource].add({
                                    key,
                                    id: item.id,
                                    resource: null,
                                    target: "remote"
                                }));
                            }
                            return promises
                        }));
                        return data;
                    },
                    update: async (id, data) => {
                        if (cache && await db[resource].get([key, "remote", id]) === undefined) {
                            await db[resource].add({
                                key,
                                id,
                                target: "remote",
                                resource: (await db[resource].get([key, "local", id]))!.resource
                            })
                        }
                        await db[resource].update([key, "local", id!], {
                            ...Object.fromEntries(Object.entries(data).map(([key, value]) => [`resource.${key}`, value]))
                        });
                        return (await  db[resource].get(["local", id!]))!.resource as any;
                    },
                    batchUpdate: async data => {
                        return Promise.all(data.map(async item => {
                            const {id, ...rest} = item;
                            if (cache && await db[resource].get([key, "remote", id]) === undefined) {
                                await db[resource].add({
                                    key,
                                    id,
                                    target: "remote",
                                    resource: (await db[resource].get([key, "local", id]))!.resource
                                })
                            }
                            await db[resource].update([key, "local", id!], {
                                target: "local",
                                ...Object.fromEntries(Object.entries(rest).map(([key, value]) => [`resource.${key}`, value]))
                            });
                            return (await db[resource].get([key, "local", id]))!.resource as any;
                        }));
                    },
                    destroy: async id => {
                        if (cache && await db[resource].get([key, "remote", id]) === undefined) {
                            await db[resource].add({
                                key,
                                id,
                                target: "remote",
                                resource: (await db[resource].get([key, "local", id]))!.resource
                            })
                        }
                        await db[resource].delete([key, "local", id!])
                    },
                    batchDestroy: async ids => {
                        await Promise.all(ids.map(async id => {
                            if (cache && await db[resource].get([key, "remote", id]) === undefined) {
                                await db[resource].add({
                                    key,
                                    id,
                                    target: "remote",
                                    resource: (await db[resource].get([key, "local", id]))!.resource
                                })
                            }
                            await db[resource].delete([key, "local", id!])
                        }))
                    },
                    query: methodNotSupported,
                    refresh: async id => ({
                        data: id !== undefined ? (await db[resource].get([key, "local", id]))?.resource : (await db[resource].where({target: "local"}).toArray()).map(item => item.resource) as any,
                        meta: undefined as any,
                        error: null
                    }),
                    getCache: async () => {
                        const map = new Map<Resource["id"], {
                            id: Resource["id"],
                            local: Resource | null,
                            remote?: Resource | null
                        }>;

                        for (const entry of await db[resource].toArray()) {
                            if (!map.has(entry.id)) {
                                map.set(entry.id, {
                                    id: entry.id,
                                    local: null,
                                    [entry.target]: entry.resource,
                                });
                            }
                            else {
                                map.get(entry.id)![entry.target] = entry.resource;
                            }
                        }

                        return [...map.values()] as any;
                    },
                    sync: async (...ids) => {
                        await Promise.all(ids.map(id => {
                            db[resource].delete([key, "remote", id!])
                        }))
                    },
                    addOfflineListener: () => () => undefined
                }
            },
            eventHook: () => {}
        }
    }
}