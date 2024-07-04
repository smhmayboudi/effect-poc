//@ts-nocheck

import {
  Array,
  Cause,
  Context,
  Data,
  Effect,
  Fiber,
  Layer,
  MutableRef,
  Runtime,
  Supervisor,
} from 'effect';
import * as express from 'express';
import type * as NodeHttp from 'node:http';
import type * as NodeNet from 'node:net';

import type {} from 'express-serve-static-core';
import type {} from 'qs';

// =============================================================================
// Express Integration
// =============================================================================

export class Express extends Context.Tag('Express')<
  Express,
  Effect.Effect.Success<ReturnType<typeof makeExpress>>
>() {
  static Live(
    hostname: string,
    port: number
  ): Layer.Layer<Express, never, never>;
  static Live<R>(
    hostname: string,
    port: number,
    exitHandler: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => (cause: Cause.Cause<never>) => Effect.Effect<void, never, R>
  ): Layer.Layer<Express, never, R>;
  static Live<R>(
    hostname: string,
    port: number,
    exitHandler?: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => (cause: Cause.Cause<never>) => Effect.Effect<void, never, R>
  ): Layer.Layer<Express, never, R> {
    return Layer.scoped(
      Express,
      makeExpress(hostname, port, exitHandler ?? defaultExitHandler)
    );
  }
}

export const Live = Express.Live;

export type ExitHandler<R> = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => (cause: Cause.Cause<never>) => Effect.Effect<void, never, R>;

export class ServerError extends Data.TaggedError('ServerError')<{
  readonly method: ServerMethod;
  readonly error: Error;
}> {}

export type ServerMethod = 'close' | 'listen';

export const makeExpress = <R>(
  hostname: string,
  port: number,
  exitHandler: ExitHandler<R>
) =>
  Effect.gen(function* (_) {
    // Create a ref to track whether or not the server is open to connections
    const open = yield* _(
      Effect.acquireRelease(Effect.succeed(MutableRef.make(true)), ref =>
        Effect.succeed(MutableRef.set(ref, false))
      )
    );

    // Create the Express Application
    const app = yield* _(Effect.sync(() => express()));

    // Create the Express Server
    const connections = new Set<NodeNet.Socket>();
    const openServer = Effect.async<NodeHttp.Server>(resume => {
      const onError = (error: Error) => {
        resume(Effect.die(new ServerError({method: 'listen', error})));
      };
      const server = app.listen(port, hostname, () => {
        resume(
          Effect.sync(() => {
            server.removeListener('error', onError);
            return server;
          })
        );
      });
      server.addListener('error', onError);
      server.on('connection', connection => {
        connections.add(connection);
        connection.on('close', () => {
          connections.delete(connection);
        });
      });
    });
    const closeServer = (server: NodeHttp.Server) =>
      Effect.async<void>(resume => {
        connections.forEach(connection => {
          connection.end();
          connection.destroy();
        });
        server.close(error => {
          if (error) {
            resume(Effect.die(new ServerError({method: 'close', error})));
          } else {
            resume(Effect.void);
          }
        });
      });
    const server = yield* _(
      Effect.acquireRelease(openServer, server => closeServer(server))
    );

    // Create a supervisor to properly track and propagate interruption
    const supervisor = yield* _(
      Effect.acquireRelease(Supervisor.track, supervisor =>
        supervisor.value.pipe(Effect.flatMap(Fiber.interruptAll))
      )
    );

    // Allow for providing route handlers to a custom Express runtime
    const runtime = <
      Handlers extends Array.NonEmptyReadonlyArray<
        EffectRequestHandler<any, any, any, any, any, any>
      >,
    >(
      handlers: Handlers
    ) =>
      Effect.runtime<
        Effect.Effect.Context<ReturnType<Handlers[number]>>
      >().pipe(
        Effect.map(runtime =>
          Array.map(
            handlers,
            (handler): express.RequestHandler =>
              (req, res, next) =>
                Runtime.runFork(runtime)(
                  Effect.onError(
                    MutableRef.get(open)
                      ? handler(req, res, next)
                      : Effect.interrupt,
                    exitHandler(req, res, next)
                  )
                )
          )
        ),
        Effect.supervised(supervisor)
      );

    return {
      app,
      server,
      runtime,
    };
  });

export const withExpressApp = <A, E, R>(
  f: (app: express.Express) => Effect.Effect<A, E, R>
) => Express.pipe(Effect.flatMap(({app}) => f(app)));

export const withExpressServer = <A, E, R>(
  f: (server: NodeHttp.Server) => Effect.Effect<A, E, R>
) => Express.pipe(Effect.flatMap(({server}) => f(server)));

export const withExpressRuntime = Effect.serviceFunctionEffect(
  Express,
  ({runtime}) => runtime
);

export const defaultExitHandler =
  (_: express.Request, res: express.Response, _next: express.NextFunction) =>
  (cause: Cause.Cause<never>): Effect.Effect<void> =>
    Cause.isDie(cause)
      ? Effect.logError(cause)
      : Effect.sync(() => res.status(500).end());

export const methods = [
  'all',
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'options',
  'head',
  'checkout',
  'connect',
  'copy',
  'lock',
  'merge',
  'mkactivity',
  'mkcol',
  'move',
  'm-search',
  'notify',
  'propfind',
  'proppatch',
  'purge',
  'report',
  'search',
  'subscribe',
  'trace',
  'unlock',
  'unsubscribe',
] as const;

export type Methods = (typeof methods)[number];

export type PathParams = string | RegExp | Array<string | RegExp>;

export interface ParamsDictionary {
  [key: string]: string;
}

export interface ParsedQs {
  [key: string]:
    | undefined
    | string
    | Array<string>
    | ParsedQs
    | Array<ParsedQs>;
}

export interface EffectRequestHandler<
  R,
  P = ParamsDictionary,
  ResBody = any,
  ReqBody = any,
  ReqQuery = ParsedQs,
  Locals extends Record<string, any> = Record<string, any>,
> {
  (
    req: express.Request<P, ResBody, ReqBody, ReqQuery, Locals>,
    res: express.Response<ResBody, Locals>,
    next: express.NextFunction
  ): Effect.Effect<void, never, R>;
}

const match =
  (method: Methods) =>
  <
    Handlers extends Array.NonEmptyReadonlyArray<
      EffectRequestHandler<any, any, any, any, any, any>
    >,
  >(
    path: PathParams,
    ...handlers: Handlers
  ): Effect.Effect<
    void,
    never,
    Express | Effect.Effect.Context<ReturnType<Handlers[number]>>
  > =>
    withExpressRuntime(handlers).pipe(
      Effect.flatMap(handlers =>
        withExpressApp(app =>
          Effect.sync(() => {
            app[method](path, ...handlers);
          })
        )
      )
    );

export const all = match('all');
export const get = match('get');
export const post = match('post');
export const put = match('put');
const delete_ = match('delete');
export {delete_ as delete};
export const patch = match('patch');
export const options = match('options');
export const head = match('head');
export const checkout = match('checkout');
export const connect = match('connect');
export const copy = match('copy');
export const lock = match('lock');
export const merge = match('merge');
export const mkactivity = match('mkactivity');
export const mkcol = match('mkcol');
export const move = match('move');
export const mSearch = match('m-search');
export const notify = match('notify');
export const propfind = match('propfind');
export const proppatch = match('proppatch');
export const purge = match('purge');
export const report = match('report');
export const search = match('search');
export const subscribe = match('subscribe');
export const trace = match('trace');
export const unlock = match('unlock');
export const unsubscribe = match('unsubscribe');

export function use<
  Handlers extends Array.NonEmptyReadonlyArray<
    EffectRequestHandler<any, any, any, any, any, any>
  >,
>(
  ...handlers: Handlers
): Effect.Effect<
  void,
  never,
  Express | Effect.Effect.Context<ReturnType<Handlers[number]>>
>;
export function use<
  Handlers extends Array.NonEmptyReadonlyArray<
    EffectRequestHandler<any, any, any, any, any, any>
  >,
>(
  path: PathParams,
  ...handlers: Handlers
): Effect.Effect<
  void,
  never,
  Express | Effect.Effect.Context<ReturnType<Handlers[number]>>
>;
export function use(...args: Array<any>): Effect.Effect<void, never, Express> {
  return withExpressApp(app => {
    if (typeof args[0] === 'function') {
      return withExpressRuntime(
        args as unknown as Array.NonEmptyReadonlyArray<
          EffectRequestHandler<any, any, any, any, any, any>
        >
      ).pipe(
        Effect.flatMap(handlers => Effect.sync(() => app.use(...handlers)))
      );
    } else {
      return withExpressRuntime(
        args.slice(1) as unknown as Array.NonEmptyReadonlyArray<
          EffectRequestHandler<any, any, any, any, any, any>
        >
      ).pipe(
        Effect.flatMap(handlers =>
          Effect.sync(() => app.use(args[0], ...handlers))
        )
      );
    }
  });
}
