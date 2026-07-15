# @micros-ya/rpc

A lean, generic **typed gRPC client factory**. Give it a `.proto` path + a
TypeScript interface and it returns a promise-based client — no per-service
boilerplate, no hand-written stubs. Depends only on `@grpc/grpc-js` +
`@grpc/proto-loader`.

```bash
pnpm add @micros-ya/rpc @grpc/grpc-js
```

Pairs with [`@micros-ya/mtls`](https://github.com/oneroodev/micros-ya-platform/tree/main/packages/mtls)
for mutual-TLS credentials.

## Usage

Describe the remote service as a TS interface (camelCase methods, one per RPC),
then build the client:

```ts
import { createGrpcClient, type RpcOptions } from '@micros-ya/rpc';
import { createClientCredentials } from '@micros-ya/mtls';

// 1. the typed surface (usually shipped by the service's contract package)
interface AuthClient {
  register(req: { email: string; password: string }): Promise<{ user_id: string }>;
  login(req: { email: string; password: string }): Promise<{ access_token: string }>;
  close(): void;
}

// 2. build it
const auth = createGrpcClient<AuthClient>({
  protoPath: '/abs/path/auth.proto',
  package: 'micros.auth.v1',   // proto package
  service: 'AuthService',      // service name inside the package
  address: process.env.AUTH_GRPC_ADDR!,  // "auth:50051"
  credentials: createClientCredentials(), // mTLS; or grpc.credentials.createInsecure()
});

// 3. call it — fully typed, promise-based
const { user_id } = await auth.register({ email, password });
auth.close();
```

### Recommended: a contract package exports a descriptor

Bundle the three proto identifiers so callers spread them in one line:

```ts
// in the service's contract package
import { join } from 'path';
export const AUTH_DESCRIPTOR = {
  protoPath: join(__dirname, '..', 'proto', 'auth.proto'),
  package: 'micros.auth.v1',
  service: 'AuthService',
} as const;

// in the consumer
const auth = createGrpcClient<AuthClient>({
  ...AUTH_DESCRIPTOR, address, credentials,
});
```

## API

`createGrpcClient<T extends object>(config): T & { close(): void }`

`config` = `RpcOptions` + proto descriptor:

| Field | Type | Notes |
|-------|------|-------|
| `address` | `string` | `host:port` of the server |
| `credentials` | `ChannelCredentials` | from `@micros-ya/mtls` or `grpc.credentials.createInsecure()` |
| `metadata?` | `() => Metadata` | called per request; use it to inject a correlation id |
| `protoPath` | `string` | absolute path to the `.proto` |
| `package` | `string` | fully-qualified proto package |
| `service` | `string` | service name within the package |

`RpcOptions` is exported separately for typing consumer options.

## Behavior & conventions

- **Method mapping:** an accessed method `getUser` maps to the PascalCase RPC
  `GetUser`. Name your interface methods in camelCase.
- **Wire format:** loaded with `keepCase: true`, so message fields stay
  **snake_case** on the wire. Type your request/response interfaces in snake_case
  (e.g. `user_id`, `access_token`) to match the proto, or map at the edge.
- **Unary only:** the Proxy promisifies unary calls. Add streaming explicitly if
  you need it.
- **Single choke point:** deadlines, retries, and tracing belong here so every
  client gets them uniformly.

Server side: keep your gRPC server's loader on `keepCase: true` too, so both ends
agree on field casing.
