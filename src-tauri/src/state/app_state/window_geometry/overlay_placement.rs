use super::*;

#[cfg(target_os = "windows")]
use crate::state::app_state::native_window::applied_overlay_frame_from_hwnd;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::state::app_state) enum OverlayRestoreSource {
    #[cfg(any(target_os = "windows", test))]
    TrustedNative,
    LegacyPhysical,
    InferredLogical,
    Default,
}

impl OverlayRestoreSource {
    pub(in crate::state::app_state) fn as_str(self) -> &'static str {
        match self {
            #[cfg(any(target_os = "windows", test))]
            Self::TrustedNative => "native",
            Self::LegacyPhysical => "legacyPhysical",
            Self::InferredLogical => "inferredLogical",
            Self::Default => "default",
        }
    }

    #[cfg(any(target_os = "windows", test))]
    pub(in crate::state::app_state) fn initial_trust(self) -> OverlayPlacementTrust {
        if self == Self::InferredLogical {
            OverlayPlacementTrust::Tainted
        } else {
            OverlayPlacementTrust::Clean
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::state::app_state) enum NativeRejectReason {
    #[cfg(any(target_os = "windows", test))]
    None,
    #[cfg(any(target_os = "windows", test))]
    Missing,
    #[cfg(any(target_os = "windows", test))]
    EchoMismatch,
    #[cfg(any(target_os = "windows", test))]
    Invalid,
    #[cfg(not(target_os = "windows"))]
    Unused,
}

impl NativeRejectReason {
    pub(in crate::state::app_state) fn as_str(self) -> &'static str {
        match self {
            #[cfg(any(target_os = "windows", test))]
            Self::None => "none",
            #[cfg(any(target_os = "windows", test))]
            Self::Missing => "missing",
            #[cfg(any(target_os = "windows", test))]
            Self::EchoMismatch => "echoMismatch",
            #[cfg(any(target_os = "windows", test))]
            Self::Invalid => "invalid",
            #[cfg(not(target_os = "windows"))]
            Self::Unused => "unused",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::state::app_state) enum OverlayPlacementTrust {
    Clean,
    #[cfg(any(target_os = "windows", test))]
    Tainted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::state::app_state) enum OverlayPersistenceAuthority {
    General,
    #[cfg(any(target_os = "windows", test))]
    NativeMoveEnded,
    Reset,
}

impl OverlayPersistenceAuthority {
    pub(in crate::state::app_state) fn establishes_trust(self) -> bool {
        match self {
            Self::General => false,
            #[cfg(any(target_os = "windows", test))]
            Self::NativeMoveEnded => true,
            Self::Reset => true,
        }
    }
}

pub(in crate::state::app_state) fn next_overlay_placement_trust(
    current: OverlayPlacementTrust,
    authority: OverlayPersistenceAuthority,
) -> OverlayPlacementTrust {
    if authority.establishes_trust() {
        OverlayPlacementTrust::Clean
    } else {
        current
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::state::app_state) struct NativePlacement {
    pub(in crate::state::app_state) position: OverlayPosition,
    pub(in crate::state::app_state) width: f64,
    pub(in crate::state::app_state) height: f64,
    pub(in crate::state::app_state) target_scale: f64,
}

impl NativePlacement {
    pub(in crate::state::app_state) fn native_rect(self) -> NativeRect {
        NativeRect {
            x: self.position.x,
            y: self.position.y,
            width: self.width * self.target_scale,
            height: self.height * self.target_scale,
        }
    }
}

pub(in crate::state::app_state) fn content_offset_change(
    offset: Option<f64>,
    previous: Option<f64>,
) -> Option<(f64, f64)> {
    let offset = offset.filter(|value| value.is_finite())?;
    Some((offset, offset - previous.unwrap_or(offset)))
}

pub(in crate::state::app_state) fn adjust_overlay_resize_position(
    placement: &mut NativePlacement,
    current: NativePlacement,
    anchor: &OverlayResizeAnchor,
    fixed_position_delta_x: Option<f64>,
    fixed_position_delta_y: Option<f64>,
    content_left_delta: Option<f64>,
    content_top_delta: Option<f64>,
) {
    let scale = placement.target_scale;
    match anchor {
        OverlayResizeAnchor::BottomLeft => {
            placement.position.y += (current.height - placement.height) * scale
        }
        OverlayResizeAnchor::TopRight => {
            placement.position.x += (current.width - placement.width) * scale
        }
        OverlayResizeAnchor::BottomRight => {
            placement.position.x += (current.width - placement.width) * scale;
            placement.position.y += (current.height - placement.height) * scale;
        }
        OverlayResizeAnchor::Center => {
            placement.position.x += (current.width - placement.width) * scale / 2.0;
            placement.position.y += (current.height - placement.height) * scale / 2.0;
        }
        OverlayResizeAnchor::FixedPosition | OverlayResizeAnchor::TopLeft => {}
    }

    if matches!(anchor, OverlayResizeAnchor::FixedPosition) {
        if let Some(delta_x) = fixed_position_delta_x {
            placement.position.x += delta_x * scale;
        }
        if let Some(delta_y) = fixed_position_delta_y {
            placement.position.y += delta_y * scale;
        }
    }

    if let Some(delta) = content_left_delta.filter(|delta| *delta != 0.0) {
        match anchor {
            OverlayResizeAnchor::Center => placement.position.x -= delta * scale / 2.0,
            OverlayResizeAnchor::TopRight | OverlayResizeAnchor::BottomRight => {}
            OverlayResizeAnchor::FixedPosition => placement.position.x -= delta * scale,
            _ => placement.position.x -= delta * scale,
        }
    }

    if let Some(delta) = content_top_delta.filter(|delta| *delta != 0.0) {
        match anchor {
            OverlayResizeAnchor::Center => placement.position.y -= delta * scale / 2.0,
            OverlayResizeAnchor::BottomLeft | OverlayResizeAnchor::BottomRight => {}
            OverlayResizeAnchor::FixedPosition => placement.position.y -= delta * scale,
            _ => placement.position.y -= delta * scale,
        }
    }

    #[cfg(target_os = "macos")]
    {
        // AppKit의 원점 내림 전에 이동량을 대칭 반올림해 왕복 시 위치 누적 방지
        placement.position.x =
            current.position.x + (placement.position.x - current.position.x).round();
        placement.position.y =
            current.position.y + (placement.position.y - current.position.y).round();
    }
}

#[derive(Clone, Debug)]
pub(in crate::state::app_state) enum PendingOverlayScaleResolution {
    #[cfg(any(target_os = "windows", test))]
    Windows { stored: Option<OverlayBounds> },
    #[cfg(not(target_os = "windows"))]
    NonWindowsLegacyPhysical { stored: OverlayBounds },
}

#[derive(Clone, Debug)]
pub(in crate::state::app_state) struct ResolvedOverlayPlacement {
    pub(in crate::state::app_state) placement: NativePlacement,
    pub(in crate::state::app_state) resize_basis: NativePlacement,
    pub(in crate::state::app_state) had_stored_bounds: bool,
    pub(in crate::state::app_state) source: OverlayRestoreSource,
    pub(in crate::state::app_state) native_reject_reason: NativeRejectReason,
    pub(in crate::state::app_state) candidate_count: usize,
    pub(in crate::state::app_state) selected_monitor: Option<String>,
    pub(in crate::state::app_state) selected_scale: f64,
    pub(in crate::state::app_state) visibility_adjustment: bool,
    pub(in crate::state::app_state) monitors: MonitorData,
    pub(in crate::state::app_state) pending_scale_resolution: Option<PendingOverlayScaleResolution>,
}

#[derive(Clone, Copy)]
pub(in crate::state::app_state) struct OverlayRestoreMetadata {
    source: OverlayRestoreSource,
    native_reject_reason: NativeRejectReason,
    candidate_count: usize,
    visibility_adjustment: bool,
}

impl ResolvedOverlayPlacement {
    pub(in crate::state::app_state) fn for_size(&self, width: f64, height: f64) -> NativePlacement {
        finalize_native_placement(
            self.resize_basis.position,
            width,
            height,
            self.resize_basis.target_scale,
            self.had_stored_bounds,
            &self.monitors,
        )
        .0
    }
}

pub(in crate::state::app_state) fn complete_overlay_scale_resolution(
    mut resolved: ResolvedOverlayPlacement,
    window_scale: f64,
) -> Option<ResolvedOverlayPlacement> {
    if !monitor_scale_is_usable(window_scale) {
        return None;
    }
    let Some(pending) = resolved.pending_scale_resolution.take() else {
        return Some(resolved);
    };

    let resize_basis = match pending {
        #[cfg(any(target_os = "windows", test))]
        PendingOverlayScaleResolution::Windows { stored } => match resolved.source {
            OverlayRestoreSource::TrustedNative => {
                let stored = stored?;
                NativePlacement {
                    position: resolved.resize_basis.position,
                    width: clamp_overlay_dimension(stored.width),
                    height: clamp_overlay_dimension(stored.height),
                    target_scale: window_scale,
                }
            }
            OverlayRestoreSource::LegacyPhysical => {
                let stored = stored?;
                NativePlacement {
                    position: OverlayPosition {
                        x: stored.x,
                        y: stored.y,
                    },
                    width: clamp_overlay_dimension(stored.width / window_scale),
                    height: clamp_overlay_dimension(stored.height / window_scale),
                    target_scale: window_scale,
                }
            }
            OverlayRestoreSource::InferredLogical => {
                let stored = stored?;
                NativePlacement {
                    position: OverlayPosition {
                        x: stored.x * window_scale,
                        y: stored.y * window_scale,
                    },
                    width: clamp_overlay_dimension(stored.width),
                    height: clamp_overlay_dimension(stored.height),
                    target_scale: window_scale,
                }
            }
            OverlayRestoreSource::Default => NativePlacement {
                position: OverlayPosition { x: 0.0, y: 0.0 },
                width: DEFAULT_OVERLAY_WIDTH,
                height: DEFAULT_OVERLAY_HEIGHT,
                target_scale: window_scale,
            },
        },
        #[cfg(not(target_os = "windows"))]
        PendingOverlayScaleResolution::NonWindowsLegacyPhysical { stored } => NativePlacement {
            position: OverlayPosition {
                x: stored.x / window_scale,
                y: stored.y / window_scale,
            },
            width: clamp_overlay_dimension(stored.width / window_scale),
            height: clamp_overlay_dimension(stored.height / window_scale),
            target_scale: 1.0,
        },
    };
    let result = finalize_native_placement(
        resize_basis.position,
        resize_basis.width,
        resize_basis.height,
        resize_basis.target_scale,
        resolved.had_stored_bounds,
        &resolved.monitors,
    );
    resolved.placement = result.0;
    resolved.resize_basis = resize_basis;
    resolved.selected_monitor = result.2.map(|spec| spec.identity.clone());
    resolved.selected_scale = window_scale;
    resolved.visibility_adjustment = result.1;
    Some(resolved)
}

#[derive(Clone, Debug)]
pub(in crate::state::app_state) struct AppliedOverlayFrame {
    pub(in crate::state::app_state) public_bounds: OverlayBounds,
    pub(in crate::state::app_state) native_position: Option<OverlayPosition>,
}
pub(in crate::state::app_state) fn compute_overlay_position_native(
    rect: NativeRect,
    native_scale: f64,
    had_stored_bounds: bool,
    monitors: &MonitorData,
) -> (OverlayPosition, bool, Option<&MonitorSpec>) {
    if monitors.is_empty() {
        let position = if had_stored_bounds {
            OverlayPosition {
                x: rect.x,
                y: rect.y,
            }
        } else {
            OverlayPosition {
                x: OVERLAY_MARGIN * native_scale,
                y: OVERLAY_MARGIN * native_scale,
            }
        };
        let adjusted = (position.x - rect.x).abs() > 0.5 || (position.y - rect.y).abs() > 0.5;
        return (position, adjusted, None);
    }

    let Some(fallback_spec) = monitors.primary_spec().or_else(|| monitors.first()) else {
        return (
            OverlayPosition {
                x: rect.x,
                y: rect.y,
            },
            false,
            None,
        );
    };

    if !had_stored_bounds {
        let margin = fallback_spec.logical_length_to_native(OVERLAY_MARGIN);
        let base = NativeRect {
            x: fallback_spec.work_rect_native.x + fallback_spec.work_rect_native.width
                - rect.width
                - margin,
            y: fallback_spec.work_rect_native.y + fallback_spec.work_rect_native.height
                - rect.height
                - margin,
            ..rect
        };
        let position = fallback_spec.clamp_native(base);
        return (position, true, Some(fallback_spec));
    }

    if let Some(best) = monitors.find_best_overlap_native(rect) {
        let area = best.intersection_area_native(rect);
        let min_visible_side = best.logical_length_to_native(100.0);
        let min_visible_area =
            (rect.width * rect.height * 0.25).min(min_visible_side * min_visible_side);
        if area >= min_visible_area {
            return (
                OverlayPosition {
                    x: rect.x,
                    y: rect.y,
                },
                false,
                Some(best),
            );
        }
        let position = best.clamp_native(rect);
        return (position, true, Some(best));
    }

    let position = fallback_spec.clamp_native(rect);
    (position, true, monitors.primary_spec())
}

pub(in crate::state::app_state) fn finalize_native_placement(
    position: OverlayPosition,
    width: f64,
    height: f64,
    initial_scale: f64,
    had_stored_bounds: bool,
    monitors: &MonitorData,
) -> (NativePlacement, bool, Option<&MonitorSpec>) {
    let mut placement = NativePlacement {
        position,
        width,
        height,
        target_scale: initial_scale,
    };
    let (position, mut adjusted, mut selected) = compute_overlay_position_native(
        placement.native_rect(),
        placement.target_scale,
        had_stored_bounds,
        monitors,
    );
    placement.position = position;
    if let Some(spec) = selected {
        if (placement.target_scale - spec.logical_to_native_scale).abs() > f64::EPSILON {
            placement.target_scale = spec.logical_to_native_scale;
            let result = compute_overlay_position_native(
                placement.native_rect(),
                placement.target_scale,
                had_stored_bounds,
                monitors,
            );
            placement.position = result.0;
            adjusted |= result.1;
            selected = result.2;
        }
    }
    (placement, adjusted, selected)
}

#[cfg(any(target_os = "windows", test))]
pub(in crate::state::app_state) fn stored_native_is_usable(
    native: &StoredOverlayNativePosition,
) -> bool {
    native.x.is_finite()
        && native.y.is_finite()
        && native.logical_echo_x.is_finite()
        && native.logical_echo_y.is_finite()
}

#[cfg(any(target_os = "windows", test))]
pub(in crate::state::app_state) fn stored_native_echo_matches(
    stored: &StoredOverlayBounds,
    native: &StoredOverlayNativePosition,
) -> bool {
    native.logical_echo_x.to_bits() == stored.x.to_bits()
        && native.logical_echo_y.to_bits() == stored.y.to_bits()
}

#[cfg(any(target_os = "windows", test))]
pub(in crate::state::app_state) fn resolve_windows_overlay_placement(
    stored: Option<&StoredOverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> ResolvedOverlayPlacement {
    let usable = stored.filter(|stored| overlay_bounds_are_usable(&stored.public_bounds()));
    let mut native_reject_reason = NativeRejectReason::Missing;

    let (placement, resize_basis, source, candidate_count, visibility_adjustment, selected) =
        if let Some(stored) = usable {
            if let Some(native) = stored.native_position.as_ref() {
                if !stored_native_is_usable(native) {
                    native_reject_reason = NativeRejectReason::Invalid;
                } else if !stored_native_echo_matches(stored, native) {
                    native_reject_reason = NativeRejectReason::EchoMismatch;
                } else {
                    native_reject_reason = NativeRejectReason::None;
                    let target = monitors
                        .find_by_native_point(native.x, native.y)
                        .or_else(|| monitors.primary_spec());
                    let initial_scale = target
                        .map(|spec| spec.logical_to_native_scale)
                        .unwrap_or(1.0);
                    let resize_basis = NativePlacement {
                        position: OverlayPosition {
                            x: native.x,
                            y: native.y,
                        },
                        width: clamp_overlay_dimension(stored.width),
                        height: clamp_overlay_dimension(stored.height),
                        target_scale: initial_scale,
                    };
                    let result = finalize_native_placement(
                        resize_basis.position,
                        resize_basis.width,
                        resize_basis.height,
                        resize_basis.target_scale,
                        true,
                        monitors,
                    );
                    let selected = result.2.cloned();
                    let resolved = resolved_overlay_placement(
                        result.0,
                        resize_basis,
                        true,
                        OverlayRestoreMetadata {
                            source: OverlayRestoreSource::TrustedNative,
                            native_reject_reason,
                            candidate_count: 0,
                            visibility_adjustment: result.1,
                        },
                        selected.as_ref(),
                        monitors,
                    );
                    return defer_windows_overlay_scale_resolution(resolved, usable);
                }
            }

            if !bounds_are_logical {
                let legacy_rect = NativeRect {
                    x: stored.x,
                    y: stored.y,
                    width: stored.width,
                    height: stored.height,
                };
                let target = monitors
                    .find_best_overlap_native(legacy_rect)
                    .or_else(|| monitors.primary_spec());
                let initial_scale = target
                    .map(|spec| spec.logical_to_native_scale)
                    .unwrap_or(1.0);
                let width = clamp_overlay_dimension(stored.width / initial_scale);
                let height = clamp_overlay_dimension(stored.height / initial_scale);
                let resize_basis = NativePlacement {
                    position: OverlayPosition {
                        x: stored.x,
                        y: stored.y,
                    },
                    width,
                    height,
                    target_scale: initial_scale,
                };
                let result = finalize_native_placement(
                    resize_basis.position,
                    resize_basis.width,
                    resize_basis.height,
                    resize_basis.target_scale,
                    true,
                    monitors,
                );
                (
                    result.0,
                    resize_basis,
                    OverlayRestoreSource::LegacyPhysical,
                    0,
                    result.1,
                    result.2,
                )
            } else {
                let mut candidates: Vec<(&MonitorSpec, NativePlacement)> = monitors
                    .specs
                    .iter()
                    .filter_map(|spec| {
                        let placement = NativePlacement {
                            position: OverlayPosition {
                                x: stored.x * spec.logical_to_native_scale,
                                y: stored.y * spec.logical_to_native_scale,
                            },
                            width: clamp_overlay_dimension(stored.width),
                            height: clamp_overlay_dimension(stored.height),
                            target_scale: spec.logical_to_native_scale,
                        };
                        spec.full_rect_native
                            .contains_point(placement.position.x, placement.position.y)
                            .then_some((spec, placement))
                    })
                    .collect();
                // tao 열거 인덱스는 후보마다 고유
                candidates.sort_by_key(|(spec, _)| spec.enumeration_index);
                let candidate_count = candidates.len();
                let initial = candidates
                    .first()
                    .map(|(_, placement)| *placement)
                    .unwrap_or_else(|| {
                        let scale = monitors
                            .primary_spec()
                            .map(|spec| spec.logical_to_native_scale)
                            .unwrap_or(1.0);
                        NativePlacement {
                            position: OverlayPosition {
                                x: stored.x * scale,
                                y: stored.y * scale,
                            },
                            width: clamp_overlay_dimension(stored.width),
                            height: clamp_overlay_dimension(stored.height),
                            target_scale: scale,
                        }
                    });
                let result = finalize_native_placement(
                    initial.position,
                    initial.width,
                    initial.height,
                    initial.target_scale,
                    true,
                    monitors,
                );
                (
                    result.0,
                    initial,
                    OverlayRestoreSource::InferredLogical,
                    candidate_count,
                    result.1,
                    result.2,
                )
            }
        } else {
            let scale = monitors
                .primary_spec()
                .map(|spec| spec.logical_to_native_scale)
                .unwrap_or(1.0);
            let resize_basis = NativePlacement {
                position: OverlayPosition { x: 0.0, y: 0.0 },
                width: DEFAULT_OVERLAY_WIDTH,
                height: DEFAULT_OVERLAY_HEIGHT,
                target_scale: scale,
            };
            let result = finalize_native_placement(
                resize_basis.position,
                resize_basis.width,
                resize_basis.height,
                resize_basis.target_scale,
                false,
                monitors,
            );
            (
                result.0,
                resize_basis,
                OverlayRestoreSource::Default,
                0,
                result.1,
                result.2,
            )
        };

    let resolved = resolved_overlay_placement(
        placement,
        resize_basis,
        source != OverlayRestoreSource::Default,
        OverlayRestoreMetadata {
            source,
            native_reject_reason,
            candidate_count,
            visibility_adjustment,
        },
        selected,
        monitors,
    );
    defer_windows_overlay_scale_resolution(resolved, usable)
}

#[cfg(any(target_os = "windows", test))]
pub(in crate::state::app_state) fn defer_windows_overlay_scale_resolution(
    mut resolved: ResolvedOverlayPlacement,
    stored: Option<&StoredOverlayBounds>,
) -> ResolvedOverlayPlacement {
    if resolved.monitors.is_empty() {
        resolved.pending_scale_resolution = Some(PendingOverlayScaleResolution::Windows {
            stored: stored.map(StoredOverlayBounds::public_bounds),
        });
    }
    resolved
}

pub(in crate::state::app_state) fn resolved_overlay_placement(
    placement: NativePlacement,
    resize_basis: NativePlacement,
    had_stored_bounds: bool,
    metadata: OverlayRestoreMetadata,
    selected: Option<&MonitorSpec>,
    monitors: &MonitorData,
) -> ResolvedOverlayPlacement {
    ResolvedOverlayPlacement {
        placement,
        resize_basis,
        had_stored_bounds,
        source: metadata.source,
        native_reject_reason: metadata.native_reject_reason,
        candidate_count: metadata.candidate_count,
        selected_monitor: selected.map(|spec| spec.identity.clone()),
        selected_scale: selected
            .map(|spec| spec.scale_factor)
            .unwrap_or(placement.target_scale),
        visibility_adjustment: metadata.visibility_adjustment,
        monitors: monitors.clone(),
        pending_scale_resolution: None,
    }
}

#[cfg(target_os = "windows")]
pub(in crate::state::app_state) fn resolve_overlay_placement(
    stored: Option<&StoredOverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> ResolvedOverlayPlacement {
    resolve_windows_overlay_placement(stored, bounds_are_logical, monitors)
}

#[cfg(not(target_os = "windows"))]
pub(in crate::state::app_state) fn resolve_overlay_placement(
    stored: Option<&StoredOverlayBounds>,
    bounds_are_logical: bool,
    monitors: &MonitorData,
) -> ResolvedOverlayPlacement {
    let usable = stored
        .map(StoredOverlayBounds::public_bounds)
        .filter(overlay_bounds_are_usable);
    let normalized = normalize_stored_overlay_bounds(stored, bounds_are_logical, monitors, None);
    let needs_window_scale =
        !bounds_are_logical && monitors.is_empty() && normalized.is_none() && usable.is_some();
    let had_stored_bounds = normalized.is_some() || needs_window_scale;
    let bounds = normalized
        .or_else(|| needs_window_scale.then(|| usable.clone()).flatten())
        .unwrap_or(OverlayBounds {
            x: 0.0,
            y: 0.0,
            width: DEFAULT_OVERLAY_WIDTH,
            height: DEFAULT_OVERLAY_HEIGHT,
        });
    let resize_basis = NativePlacement {
        position: OverlayPosition {
            x: bounds.x,
            y: bounds.y,
        },
        width: clamp_overlay_dimension(bounds.width),
        height: clamp_overlay_dimension(bounds.height),
        target_scale: 1.0,
    };
    let result = finalize_native_placement(
        resize_basis.position,
        resize_basis.width,
        resize_basis.height,
        resize_basis.target_scale,
        had_stored_bounds,
        monitors,
    );
    let source = if !had_stored_bounds {
        OverlayRestoreSource::Default
    } else if bounds_are_logical {
        OverlayRestoreSource::InferredLogical
    } else {
        OverlayRestoreSource::LegacyPhysical
    };
    let mut resolved = resolved_overlay_placement(
        result.0,
        resize_basis,
        had_stored_bounds,
        OverlayRestoreMetadata {
            source,
            native_reject_reason: NativeRejectReason::Unused,
            candidate_count: 0,
            visibility_adjustment: result.1,
        },
        result.2,
        monitors,
    );
    if needs_window_scale {
        resolved.pending_scale_resolution =
            Some(PendingOverlayScaleResolution::NonWindowsLegacyPhysical {
                stored: usable.expect("validated legacy overlay bounds"),
            });
    }
    resolved
}

pub(in crate::state::app_state) fn public_overlay_bounds_from_native(
    rect: NativeRect,
    native_scale: f64,
) -> Option<OverlayBounds> {
    if !monitor_scale_is_usable(native_scale)
        || ![rect.x, rect.y, rect.width, rect.height]
            .into_iter()
            .all(f64::is_finite)
        || rect.width <= 0.0
        || rect.height <= 0.0
    {
        return None;
    }
    Some(OverlayBounds {
        x: rect.x / native_scale,
        y: rect.y / native_scale,
        width: rect.width / native_scale,
        height: rect.height / native_scale,
    })
}

pub(in crate::state::app_state) fn applied_overlay_frame_from_native(
    rect: NativeRect,
    native_scale: f64,
    include_native_position: bool,
) -> Option<AppliedOverlayFrame> {
    Some(AppliedOverlayFrame {
        public_bounds: public_overlay_bounds_from_native(rect, native_scale)?,
        native_position: include_native_position.then_some(OverlayPosition {
            x: rect.x,
            y: rect.y,
        }),
    })
}

pub(in crate::state::app_state) fn overlay_restore_window_scale(
    window: &WebviewWindow,
) -> Result<f64> {
    #[cfg(target_os = "windows")]
    let scale = {
        use windows::Win32::UI::HiDpi::GetDpiForWindow;

        let hwnd = window.hwnd()?;
        f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96.0
    };
    #[cfg(not(target_os = "windows"))]
    let scale = window.scale_factor()?;

    monitor_scale_is_usable(scale)
        .then_some(scale)
        .ok_or_else(|| anyhow!("overlay window scale is invalid"))
}

pub(in crate::state::app_state) fn applied_overlay_frame_from_window(
    window: &WebviewWindow,
) -> Result<AppliedOverlayFrame> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd()?;
        unsafe { applied_overlay_frame_from_hwnd(hwnd) }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let scale = window.scale_factor()?;
        let position = window.outer_position()?;
        let size = window.outer_size()?;
        applied_overlay_frame_from_native(
            NativeRect {
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
            },
            scale,
            false,
        )
        .ok_or_else(|| anyhow!("overlay frame measurement is invalid"))
    }
}

pub(in crate::state::app_state) fn native_placement_from_window(
    window: &WebviewWindow,
) -> Result<NativePlacement> {
    let frame = applied_overlay_frame_from_window(window)?;
    #[cfg(target_os = "windows")]
    let scale = window.scale_factor()?;
    #[cfg(target_os = "windows")]
    let position = frame
        .native_position
        .ok_or_else(|| anyhow!("overlay native position is unavailable"))?;
    #[cfg(not(target_os = "windows"))]
    let position = OverlayPosition {
        x: frame.public_bounds.x,
        y: frame.public_bounds.y,
    };
    #[cfg(target_os = "windows")]
    let target_scale = scale;
    #[cfg(not(target_os = "windows"))]
    let target_scale = 1.0;
    Ok(NativePlacement {
        position,
        width: frame.public_bounds.width,
        height: frame.public_bounds.height,
        target_scale,
    })
}

pub(in crate::state::app_state) fn applied_overlay_frame_from_placement(
    placement: NativePlacement,
) -> AppliedOverlayFrame {
    #[cfg(target_os = "windows")]
    let include_native_position = true;
    #[cfg(not(target_os = "windows"))]
    let include_native_position = false;
    applied_overlay_frame_from_native(
        placement.native_rect(),
        placement.target_scale,
        include_native_position,
    )
    .expect("validated overlay placement")
}

pub(in crate::state::app_state) fn persist_overlay_placement_from_window(
    window: &WebviewWindow,
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
    trust: &Arc<Mutex<OverlayPlacementTrust>>,
    authority: OverlayPersistenceAuthority,
) -> Result<()> {
    let frame = applied_overlay_frame_from_window(window)?;
    persist_overlay_placement(store, generation, trust, frame, None, None, authority)
}

pub(in crate::state::app_state) fn persist_overlay_placement(
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
    trust: &Arc<Mutex<OverlayPlacementTrust>>,
    frame: AppliedOverlayFrame,
    content_left_offset: Option<f64>,
    content_top_offset: Option<f64>,
    authority: OverlayPersistenceAuthority,
) -> Result<()> {
    let mut trust_guard = trust.lock();
    let next_trust = next_overlay_placement_trust(*trust_guard, authority);
    #[cfg(target_os = "windows")]
    let include_native_position = true;
    #[cfg(not(target_os = "windows"))]
    let include_native_position = false;
    let stored = stored_overlay_bounds_for_persistence(&frame, next_trust, include_native_position);

    store.update_deferred(move |state| {
        state.overlay_bounds = Some(stored);
        state.overlay_bounds_are_logical = true;
        if let Some(offset) = content_left_offset {
            state.overlay_last_content_left_offset = Some(offset);
        }
        if let Some(offset) = content_top_offset {
            state.overlay_last_content_top_offset = Some(offset);
        }
    })?;
    *trust_guard = next_trust;
    drop(trust_guard);
    let scheduled_generation = generation.fetch_add(1, Ordering::SeqCst).wrapping_add(1);

    let store = Arc::clone(store);
    let generation = Arc::clone(generation);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(OVERLAY_BOUNDS_DEBOUNCE_MS)).await;
        if generation.load(Ordering::SeqCst) != scheduled_generation {
            return;
        }
        if let Err(err) = store.flush() {
            log::warn!("failed to flush debounced overlay bounds: {err}");
        }
    });

    Ok(())
}

pub(in crate::state::app_state) fn stored_overlay_bounds_for_persistence(
    frame: &AppliedOverlayFrame,
    trust: OverlayPlacementTrust,
    include_native_position: bool,
) -> StoredOverlayBounds {
    let public = &frame.public_bounds;
    let native_position = if include_native_position && trust == OverlayPlacementTrust::Clean {
        frame
            .native_position
            .map(|position| StoredOverlayNativePosition {
                x: position.x,
                y: position.y,
                logical_echo_x: public.x,
                logical_echo_y: public.y,
            })
    } else {
        None
    };
    StoredOverlayBounds {
        x: public.x,
        y: public.y,
        width: public.width,
        height: public.height,
        native_position,
    }
}

pub(in crate::state::app_state) fn flush_deferred_overlay_bounds(
    store: &Arc<AppStore>,
    generation: &Arc<AtomicU64>,
) -> Result<()> {
    generation.fetch_add(1, Ordering::SeqCst);
    store.flush()
}
