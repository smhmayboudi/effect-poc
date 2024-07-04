import * as Schema from '@effect/schema/Schema';
import {
  Array,
  Cause,
  Context,
  Effect,
  HashMap,
  Layer,
  Option,
  Ref,
} from 'effect';

// =============================================================================
// Todo
// =============================================================================

export class Todo extends Schema.Class<Todo>('Todo')({
  id: Schema.Number,
  title: Schema.String,
  completed: Schema.Boolean,
}) {}

export const CreateTodoParams = Schema.Struct(Todo.fields).pipe(
  Schema.omit('id')
);
export type CreateTodoParams = typeof CreateTodoParams.Type;

export const UpdateTodoParams = Schema.partial(Schema.Struct(Todo.fields), {
  exact: true,
}).pipe(Schema.omit('id'));
export type UpdateTodoParams = typeof UpdateTodoParams.Type;

// =============================================================================
// TodoRepository
// =============================================================================

const makeTodoRepository = Effect.gen(function* (_) {
  const nextIdRef = yield* _(Ref.make(0));
  const todosRef = yield* _(Ref.make(HashMap.empty<number, Todo>()));

  const getTodo = (
    id: number
  ): Effect.Effect<Option.Option<Todo>, never, never> =>
    Ref.get(todosRef).pipe(Effect.map(HashMap.get(id)));

  const getTodos: Effect.Effect<ReadonlyArray<Todo>, never, never> = Ref.get(
    todosRef
  ).pipe(Effect.map(map => Array.fromIterable(HashMap.values(map))));

  const createTodo = (
    params: CreateTodoParams
  ): Effect.Effect<number, never, never> =>
    Ref.getAndUpdate(nextIdRef, n => n + 1).pipe(
      Effect.flatMap(id =>
        Ref.modify(todosRef, map => {
          const newTodo = new Todo({...params, id});
          const updated = HashMap.set(map, newTodo.id, newTodo);
          return [newTodo.id, updated];
        })
      )
    );

  const updateTodo = (
    id: number,
    params: UpdateTodoParams
  ): Effect.Effect<Todo, Cause.NoSuchElementException, never> =>
    Ref.get(todosRef).pipe(
      Effect.flatMap(map => {
        const maybeTodo = HashMap.get(map, id);
        if (Option.isNone(maybeTodo)) {
          return Effect.fail(new Cause.NoSuchElementException());
        }
        const newTodo = new Todo({...maybeTodo.value, ...params});
        const updated = HashMap.set(map, id, newTodo);
        return Ref.set(todosRef, updated).pipe(Effect.as(newTodo));
      })
    );

  const deleteTodo = (id: number): Effect.Effect<boolean, never, never> =>
    Ref.get(todosRef).pipe(
      Effect.flatMap(map =>
        HashMap.has(map, id)
          ? Ref.set(todosRef, HashMap.remove(map, id)).pipe(Effect.as(true))
          : Effect.succeed(false)
      )
    );

  return {
    getTodo,
    getTodos,
    createTodo,
    updateTodo,
    deleteTodo,
  } as const;
});

export class TodoRepository extends Context.Tag('TodoRepository')<
  TodoRepository,
  Effect.Effect.Success<typeof makeTodoRepository>
>() {
  static readonly Live = Layer.effect(TodoRepository, makeTodoRepository);
}
