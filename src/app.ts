//@ts-nocheck

import * as Schema from '@effect/schema/Schema';
import * as bodyParser from 'body-parser';
import {Effect, Layer, Option} from 'effect';
import * as Exp from './express';
import * as Todo from './todo';

// =============================================================================
// Application
// =============================================================================

const server = Effect.all([
  Exp.use((req, res, next) =>
    Effect.sync(() => bodyParser.json()(req, res, next))
  ),
  // GET /todos/id
  Exp.get('/todos/:id', (req, res) => {
    const id = req.params.id;
    return Todo.TodoRepository.pipe(
      Effect.flatMap(repo => repo.getTodo(Number(id))),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.sync(() => res.status(404).json(`Todo ${id} not found`)),
          onSome: todo => Effect.sync(() => res.json(todo)),
        })
      )
    );
  }),
  // GET /todos
  Exp.get('/todos', (_, res) =>
    Todo.TodoRepository.pipe(
      Effect.flatMap(repo => repo.getTodos),
      Effect.flatMap(todos => Effect.sync(() => res.json(todos)))
    )
  ),
  // POST /todos
  Exp.post('/todos', (req, res) => {
    const decodeBody = Schema.decodeUnknown(Todo.CreateTodoParams);
    return Todo.TodoRepository.pipe(
      Effect.flatMap(repo =>
        decodeBody(req.body).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.sync(() => res.status(400).json('Invalid Todo')),
            onSuccess: todo =>
              repo
                .createTodo(todo)
                .pipe(Effect.flatMap(id => Effect.sync(() => res.json(id)))),
          })
        )
      )
    );
  }),
  // PUT /todos/:id
  Exp.put('/todos/:id', (req, res) => {
    const id = req.params.id;
    const decodeBody = Schema.decodeUnknown(Todo.UpdateTodoParams);
    return Todo.TodoRepository.pipe(
      Effect.flatMap(repo =>
        decodeBody(req.body).pipe(
          Effect.matchEffect({
            onFailure: () =>
              Effect.sync(() => res.status(400).json('Invalid todo')),
            onSuccess: todo =>
              repo.updateTodo(Number(id), todo).pipe(
                Effect.matchEffect({
                  onFailure: () =>
                    Effect.sync(() =>
                      res.status(404).json(`Todo ${id} not found`)
                    ),
                  onSuccess: todo => Effect.sync(() => res.json(todo)),
                })
              ),
          })
        )
      )
    );
  }),
  // DELETE /todos/:id
  Exp.delete('/todos/:id', (req, res) => {
    const id = req.params.id;
    return Todo.TodoRepository.pipe(
      Effect.flatMap(repo => repo.deleteTodo(Number(id))),
      Effect.flatMap(deleted => Effect.sync(() => res.json({deleted})))
    );
  }),
]);

const MainLive = Exp.Live('127.0.0.1', 8888).pipe(
  Layer.merge(Todo.TodoRepository.Live)
);

server.pipe(
  Effect.zipRight(Effect.never),
  Effect.provide(MainLive),
  Effect.tapErrorCause(Effect.logError),
  Effect.runFork
);
