use std::{
    path::{Path, PathBuf},
    sync::mpsc,
    thread::{self, JoinHandle},
};

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;

use crate::models::AppStoreData;

use super::super::atomic_file::atomic_replace;

pub(super) struct PersistTicket {
    revision: u64,
    completion_rx: mpsc::Receiver<PersistCompletion>,
}

struct PersistCompletion {
    revision: u64,
    result: std::result::Result<(), String>,
}

enum WriterMessage {
    Persist {
        revision: u64,
        snapshot: Box<AppStoreData>,
        completion_tx: mpsc::Sender<PersistCompletion>,
        #[cfg(test)]
        force_failure: bool,
    },
    Shutdown {
        completion_tx: mpsc::Sender<()>,
    },
}

pub(super) struct StoreWriter {
    sender: Mutex<Option<mpsc::Sender<WriterMessage>>>,
    handle: Mutex<Option<JoinHandle<()>>>,
    #[cfg(test)]
    fail_next_persist: std::sync::atomic::AtomicBool,
    #[cfg(test)]
    persist_count: std::sync::atomic::AtomicUsize,
}

impl PersistTicket {
    pub(super) fn wait(self) -> Result<()> {
        let completion = self
            .completion_rx
            .recv()
            .with_context(|| format!("store writer stopped before revision {}", self.revision))?;
        if completion.revision != self.revision {
            return Err(anyhow!(
                "store writer returned revision {} for requested revision {}",
                completion.revision,
                self.revision
            ));
        }
        completion.result.map_err(anyhow::Error::msg)
    }
}

impl StoreWriter {
    pub(super) fn start(path: PathBuf) -> Result<Self> {
        let (sender, receiver) = mpsc::channel();
        let handle = thread::Builder::new()
            .name("dmnote-store-writer".to_string())
            .spawn(move || run_store_writer(&path, receiver))
            .context("failed to start store writer")?;
        Ok(Self {
            sender: Mutex::new(Some(sender)),
            handle: Mutex::new(Some(handle)),
            #[cfg(test)]
            fail_next_persist: std::sync::atomic::AtomicBool::new(false),
            #[cfg(test)]
            persist_count: std::sync::atomic::AtomicUsize::new(0),
        })
    }

    pub(super) fn enqueue(&self, revision: u64, snapshot: AppStoreData) -> Result<PersistTicket> {
        let (completion_tx, completion_rx) = mpsc::channel();
        let guard = self.sender.lock();
        let sender = guard.as_ref().context("store writer is shut down")?;
        #[cfg(test)]
        let force_failure = self
            .fail_next_persist
            .swap(false, std::sync::atomic::Ordering::SeqCst);
        sender
            .send(WriterMessage::Persist {
                revision,
                snapshot: Box::new(snapshot),
                completion_tx,
                #[cfg(test)]
                force_failure,
            })
            .with_context(|| format!("failed to enqueue store revision {revision}"))?;
        #[cfg(test)]
        self.persist_count
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(PersistTicket {
            revision,
            completion_rx,
        })
    }

    #[cfg(test)]
    pub(super) fn fail_next_persist(&self) {
        self.fail_next_persist
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    #[cfg(test)]
    pub(super) fn persist_count(&self) -> usize {
        self.persist_count.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub(super) fn shutdown(&self) -> Result<()> {
        let sender = self.sender.lock().take();
        let Some(sender) = sender else {
            return Ok(());
        };

        let (completion_tx, completion_rx) = mpsc::channel();
        if let Err(err) = sender.send(WriterMessage::Shutdown { completion_tx }) {
            drop(sender);
            let join_result = self
                .handle
                .lock()
                .take()
                .map(|handle| {
                    handle
                        .join()
                        .map_err(|_| anyhow!("store writer thread panicked"))
                })
                .transpose();
            join_result?;
            return Err(anyhow!("failed to enqueue store writer shutdown: {err}"));
        }
        drop(sender);
        let completion_result = completion_rx
            .recv()
            .context("store writer stopped before shutdown flush completed");
        let join_result = self
            .handle
            .lock()
            .take()
            .map(|handle| {
                handle
                    .join()
                    .map_err(|_| anyhow!("store writer thread panicked"))
            })
            .transpose();

        completion_result?;
        join_result?;
        Ok(())
    }
}

fn run_store_writer(path: &Path, receiver: mpsc::Receiver<WriterMessage>) {
    while let Ok(message) = receiver.recv() {
        match message {
            WriterMessage::Persist {
                revision,
                snapshot,
                completion_tx,
                #[cfg(test)]
                force_failure,
            } => {
                #[cfg(test)]
                let result = if force_failure {
                    Err("injected store writer failure".to_string())
                } else {
                    write_store_snapshot(path, revision, snapshot.as_ref())
                        .map_err(|err| format!("{err:#}"))
                };
                #[cfg(not(test))]
                let result = write_store_snapshot(path, revision, snapshot.as_ref())
                    .map_err(|err| format!("{err:#}"));
                let _ = completion_tx.send(PersistCompletion { revision, result });
            }
            WriterMessage::Shutdown { completion_tx } => {
                let _ = completion_tx.send(());
                break;
            }
        }
    }
}

fn write_store_snapshot(path: &Path, revision: u64, state: &AppStoreData) -> Result<()> {
    let json = serialize_store(state)?;
    atomic_replace(path, json.as_bytes(), &format!("revision-{revision}"))
}

fn serialize_store(state: &AppStoreData) -> Result<String> {
    use serde_json::{to_value, Map, Value};

    let mut root = to_value(state)?;
    if let Value::Object(ref mut obj) = root {
        let reorder = |value: &mut Value| {
            if let Value::Object(current) = value {
                let desired = ["4key", "5key", "6key", "8key"];
                let mut next = Map::new();
                for key in desired.iter() {
                    if let Some(value) = current.get(*key) {
                        next.insert((*key).to_string(), value.clone());
                    }
                }
                let mut rest: Vec<(String, Value)> = current
                    .iter()
                    .filter(|(key, _)| !desired.contains(&key.as_str()))
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect();
                rest.sort_by(|left, right| left.0.cmp(&right.0));
                for (key, value) in rest {
                    next.insert(key, value);
                }
                *value = Value::Object(next);
            }
        };

        for field in [
            "keys",
            "keyPositions",
            "statPositions",
            "graphPositions",
            "knobPositions",
            "keyCounters",
        ] {
            if let Some(value) = obj.get_mut(field) {
                reorder(value);
            }
        }
    }

    serde_json::to_string_pretty(&root).context("failed to serialize store")
}
