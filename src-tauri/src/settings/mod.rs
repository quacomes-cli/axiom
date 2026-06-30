mod model;
mod store;

pub use model::AppSettings;
pub use store::{load_or_default, save};
