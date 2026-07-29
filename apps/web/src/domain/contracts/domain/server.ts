export type ServerId =  string & { readonly __brand: 'ServerId' }

export  interface Server {
    id: ServerId,
    name: string,
    ip: string,
    status: 'online' | 'offline' | 'maintenance',
    tags: string[],
}