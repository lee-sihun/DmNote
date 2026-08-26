pub mod app;
pub(crate) mod dialog;
pub mod editor;
pub mod keys;
pub mod layout;
pub mod media;
pub mod plugin;
pub mod preset;

use tauri::{AppHandle, Manager};

use crate::{
    errors::{CmdResult, CommandError},
    state::{app_state::MutationPublicationTicket, history::HistoryAdmissionLease, AppState},
};

pub(crate) async fn run_blocking<T, F>(app: AppHandle, task: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle, &AppState) -> CmdResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        task(&app, state.inner())
    })
    .await
    .map_err(|error| CommandError::msg(format!("mutation task failed: {error}")))?
}

pub(crate) async fn run_mutation<T, F>(app: AppHandle, mutation: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle, &AppState) -> CmdResult<T> + Send + 'static,
{
    run_prepared_mutation(
        app,
        |_, _| Ok(()),
        move |app, state, ()| mutation(app, state),
    )
    .await
}

pub(crate) async fn run_prepared_mutation<T, P, Prepare, Mutation>(
    app: AppHandle,
    prepare: Prepare,
    mutation: Mutation,
) -> CmdResult<T>
where
    T: Send + 'static,
    Prepare: FnOnce(&AppHandle, &AppState) -> CmdResult<P> + Send + 'static,
    Mutation: FnOnce(&AppHandle, &AppState, P) -> CmdResult<T> + Send + 'static,
{
    let ticket = issue_mutation_ticket(&app)?;
    run_prepared_mutation_with_ticket(app, ticket, prepare, mutation).await
}

pub(crate) async fn run_prepared_mutation_with_ticket<T, P, Prepare, Mutation>(
    app: AppHandle,
    ticket: MutationPublicationTicket,
    prepare: Prepare,
    mutation: Mutation,
) -> CmdResult<T>
where
    T: Send + 'static,
    Prepare: FnOnce(&AppHandle, &AppState) -> CmdResult<P> + Send + 'static,
    Mutation: FnOnce(&AppHandle, &AppState, P) -> CmdResult<T> + Send + 'static,
{
    run_mutation_task_with_ticket(app, ticket, move |app, state, ticket| {
        let prepared = prepare(app, state)?;
        ticket.run(|| {
            state.ensure_mutation_allowed().map_err(CommandError::msg)?;
            mutation(app, state, prepared)
        })
    })
    .await
}

pub(crate) async fn run_mutation_task<T, F>(app: AppHandle, task: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle, &AppState, MutationPublicationTicket) -> CmdResult<T> + Send + 'static,
{
    let ticket = issue_mutation_ticket(&app)?;
    run_mutation_task_with_ticket(app, ticket, task).await
}

pub(crate) fn issue_mutation_ticket(app: &AppHandle) -> CmdResult<MutationPublicationTicket> {
    app.state::<AppState>()
        .issue_mutation_publication()
        .map_err(CommandError::msg)
}

pub(crate) async fn run_mutation_task_with_ticket<T, F>(
    app: AppHandle,
    ticket: MutationPublicationTicket,
    task: F,
) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle, &AppState, MutationPublicationTicket) -> CmdResult<T> + Send + 'static,
{
    run_blocking(app, move |app, state| {
        state.ensure_mutation_allowed().map_err(CommandError::msg)?;
        task(app, state, ticket)
    })
    .await
}

pub(crate) async fn run_history_mutation<T, F>(
    app: AppHandle,
    window_label: String,
    mutation: F,
) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle, &AppState, HistoryAdmissionLease) -> CmdResult<T> + Send + 'static,
{
    run_prepared_mutation(
        app,
        move |_, state| {
            state
                .admit_frontend_history_mutation(&window_label)
                .map_err(Into::into)
        },
        mutation,
    )
    .await
}
