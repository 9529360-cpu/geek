use super::error::{AppError, Result};
use serde::Deserialize;

/// Trusted shell geometry in CSS/logical pixels, never a native window handle.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
            visible: false,
        }
    }
}

impl Viewport {
    pub fn validate(&self) -> Result<()> {
        let values = [self.x, self.y, self.width, self.height];
        if values
            .iter()
            .any(|n| !n.is_finite() || *n < 0.0 || *n > 32768.0)
            || self.width < 1.0
            || self.height < 1.0
        {
            return Err(AppError::LayoutInvalid);
        }
        Ok(())
    }

    pub fn clipped(&self, width: f64, height: f64) -> Result<Self> {
        self.validate()?;
        if !width.is_finite() || !height.is_finite() || width < 1.0 || height < 1.0 {
            return Err(AppError::LayoutInvalid);
        }
        let x = self.x.min(width - 1.0);
        let y = self.y.min(height - 1.0);
        Ok(Self {
            x,
            y,
            width: self.width.min(width - x),
            height: self.height.min(height - y),
            visible: self.visible,
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WindowAction {
    Minimize,
    ToggleMaximize,
    Close,
    Drag,
}
