use super::{
    clip_hit_rect_to_bounds, hit_region_status, probe_delay_ms, validate_hit_rects,
    HitRegionStatus, OverlayHitDesiredState, OverlayHitRect, RegionSyncDecision, MAX_HIT_RECTS,
};
use std::sync::Arc;

fn desired_state() -> OverlayHitDesiredState {
    OverlayHitDesiredState {
        rects: Vec::new(),
        device_pixel_ratio: 1.0,
        last_revision: None,
        parent: None,
        visible: true,
        locked: false,
        always_on_top: true,
        resync_epoch: 0,
        renderer_session: None,
        pending_resync: true,
        probe_lease: Arc::new(()),
    }
}

// 보정 줌이 곱해진 실측 배율만 채택하고, 비정상값은 1.0으로 떨어뜨린다
#[test]
fn device_pixel_ratio_is_adopted_and_sanitized() {
    let mut desired = desired_state();

    assert!(desired.apply_regions(vec![rect(1.0)], 1, 1.25).unwrap());
    assert_eq!(desired.device_pixel_ratio, 1.25);

    assert!(desired.apply_regions(vec![rect(2.0)], 2, f64::NAN).unwrap());
    assert_eq!(desired.device_pixel_ratio, 1.0);

    assert!(desired.apply_regions(vec![rect(3.0)], 3, 0.0).unwrap());
    assert_eq!(desired.device_pixel_ratio, 1.0);
}

fn rect(x: f64) -> OverlayHitRect {
    OverlayHitRect {
        x,
        y: 0.0,
        width: 10.0,
        height: 10.0,
    }
}

#[test]
fn hit_region_revision_only_accepts_newer_values() {
    let mut desired = desired_state();
    assert!(desired.apply_regions(vec![rect(1.0)], 10, 1.0).unwrap());
    assert!(!desired.apply_regions(vec![rect(2.0)], 10, 1.0).unwrap());
    assert!(!desired
        .apply_regions(
            vec![OverlayHitRect {
                x: f64::NAN,
                y: 0.0,
                width: 10.0,
                height: 10.0,
            }],
            9,
            1.0,
        )
        .unwrap());
    assert_eq!(desired.rects, vec![rect(1.0)]);
    assert!(desired
        .apply_regions(
            vec![OverlayHitRect {
                x: f64::NAN,
                y: 0.0,
                width: 10.0,
                height: 10.0,
            }],
            11,
            1.0,
        )
        .is_err());
    assert_eq!(desired.rects, vec![rect(1.0)]);
    assert!(desired.apply_regions(vec![rect(4.0)], 11, 1.0).unwrap());
    assert_eq!(desired.rects, vec![rect(4.0)]);
}

#[test]
fn parent_replacement_and_loss_are_invalidation_edges() {
    let mut desired = desired_state();
    assert!(desired.apply_regions(vec![rect(0.0)], 1, 1.0).unwrap());
    assert!(desired.observe_parent(None));
    desired.invalidate(false).unwrap();

    assert!(!desired.observe_parent(Some(10)));
    assert!(desired.apply_regions(vec![rect(1.0)], 90, 1.0).unwrap());
    assert!(!desired.observe_parent(Some(10)));

    assert!(desired.observe_parent(Some(11)));
    desired.invalidate(false).unwrap();
    assert!(desired.rects.is_empty());
    assert_eq!(desired.last_revision, None);
    assert!(desired.apply_regions(vec![rect(2.0)], 1, 1.0).unwrap());

    assert!(desired.observe_parent(None));
    desired.mark_parent_absent();
    desired.invalidate(true).unwrap();
    assert!(desired.rects.is_empty());
    assert_eq!(desired.last_revision, None);
    assert!(!desired.observe_parent(None));
    assert!(!desired.observe_parent(Some(12)));
    assert!(desired.apply_regions(vec![rect(3.0)], 1, 1.0).unwrap());
    assert!(desired.observe_parent(None));
    desired.invalidate(false).unwrap();
    assert!(!desired.observe_parent(None));
}

#[test]
fn matching_epoch_and_renderer_session_are_accepted() {
    let mut desired = desired_state();
    let epoch = desired
        .renew_renderer_session("renderer".to_string())
        .unwrap();
    let decision = desired
        .apply_renderer_regions(vec![rect(1.0)], 1, 1.25, epoch, "renderer")
        .unwrap();

    assert_eq!(decision, RegionSyncDecision::Applied);
    assert!(decision.accepted());
    assert!(!desired.pending_resync);
    assert_eq!(desired.rects, vec![rect(1.0)]);
}

#[test]
fn renderer_session_mismatch_is_not_accepted_or_mutated() {
    let mut desired = desired_state();
    let epoch = desired
        .renew_renderer_session("renderer".to_string())
        .unwrap();
    let decision = desired
        .apply_renderer_regions(vec![rect(1.0)], 1, 1.0, epoch, "stale-renderer")
        .unwrap();

    assert_eq!(decision, RegionSyncDecision::LeaseMismatch);
    assert!(!decision.accepted());
    assert!(desired.pending_resync);
    assert!(desired.rects.is_empty());
    assert_eq!(desired.last_revision, None);
}

#[test]
fn epoch_mismatch_is_not_accepted_or_mutated() {
    let mut desired = desired_state();
    let epoch = desired
        .renew_renderer_session("renderer".to_string())
        .unwrap();
    let decision = desired
        .apply_renderer_regions(vec![rect(1.0)], 1, 1.0, epoch - 1, "renderer")
        .unwrap();

    assert_eq!(decision, RegionSyncDecision::LeaseMismatch);
    assert!(!decision.accepted());
    assert!(desired.pending_resync);
    assert!(desired.rects.is_empty());
    assert_eq!(desired.last_revision, None);
}

#[test]
fn stale_revision_keeps_valid_lease_accepted() {
    let mut desired = desired_state();
    let epoch = desired
        .renew_renderer_session("renderer".to_string())
        .unwrap();
    assert_eq!(
        desired
            .apply_renderer_regions(vec![rect(2.0)], 2, 1.0, epoch, "renderer")
            .unwrap(),
        RegionSyncDecision::Applied
    );
    let decision = desired
        .apply_renderer_regions(vec![rect(1.0)], 1, 1.0, epoch, "renderer")
        .unwrap();

    assert_eq!(decision, RegionSyncDecision::StaleRevision);
    assert!(decision.accepted());
    assert!(!desired.pending_resync);
    assert_eq!(desired.rects, vec![rect(2.0)]);
    assert_eq!(desired.last_revision, Some(2));
}

#[test]
fn hidden_locked_and_unready_states_pause_without_clearing_pending() {
    let mut desired = desired_state();
    assert!(!desired.can_probe());
    assert!(desired.pending_resync);

    desired
        .renew_renderer_session("renderer".to_string())
        .unwrap();
    assert!(desired.can_probe());

    desired.visible = false;
    assert!(!desired.can_probe());
    assert!(desired.pending_resync);

    desired.visible = true;
    desired.locked = true;
    assert!(!desired.can_probe());
    assert!(desired.pending_resync);

    desired.locked = false;
    assert!(desired.can_probe());
}

#[test]
fn measured_empty_and_fully_clipped_regions_remain_distinct() {
    assert_eq!(hit_region_status(true, 0), HitRegionStatus::Applied);
    assert_eq!(hit_region_status(false, 0), HitRegionStatus::FullyClipped);
    assert_eq!(hit_region_status(false, 1), HitRegionStatus::Applied);

    let mut desired = desired_state();
    let epoch = desired
        .renew_renderer_session("renderer".to_string())
        .unwrap();
    assert_eq!(
        desired
            .apply_renderer_regions(Vec::new(), 1, 1.0, epoch, "renderer")
            .unwrap(),
        RegionSyncDecision::Applied
    );
    assert!(desired.rects.is_empty());
    assert_eq!(desired.last_revision, Some(1));
    assert!(!desired.pending_resync);
}

#[test]
fn epoch_overflow_revokes_renderer_and_keeps_resync_pending() {
    let mut desired = desired_state();
    desired.resync_epoch = u64::MAX;
    desired.renderer_session = Some("renderer".to_string());
    desired.pending_resync = false;

    assert!(desired.invalidate(false).is_err());
    assert_eq!(desired.resync_epoch, u64::MAX);
    assert_eq!(desired.renderer_session, None);
    assert!(desired.pending_resync);
    assert!(!desired.can_probe());
}

#[test]
fn probe_schedule_reaches_indefinite_five_second_interval() {
    assert_eq!(
        (0..8).map(probe_delay_ms).collect::<Vec<_>>(),
        vec![100, 250, 500, 1_000, 5_000, 5_000, 5_000, 5_000]
    );
}

#[test]
fn hit_rect_clipping_uses_client_bounds_and_drops_empty_intersections() {
    assert_eq!(
        clip_hit_rect_to_bounds(
            OverlayHitRect {
                x: -5.0,
                y: -10.0,
                width: 20.0,
                height: 30.0,
            },
            100.0,
            100.0,
        ),
        Some(OverlayHitRect {
            x: 0.0,
            y: 0.0,
            width: 15.0,
            height: 20.0,
        })
    );
    assert_eq!(
        clip_hit_rect_to_bounds(
            OverlayHitRect {
                x: 90.0,
                y: 95.0,
                width: 30.0,
                height: 10.0,
            },
            100.0,
            100.0,
        ),
        Some(OverlayHitRect {
            x: 90.0,
            y: 95.0,
            width: 10.0,
            height: 5.0,
        })
    );
    assert_eq!(clip_hit_rect_to_bounds(rect(110.0), 100.0, 100.0), None);
    assert_eq!(clip_hit_rect_to_bounds(rect(1.0), 0.0, 100.0), None);
}

#[cfg(target_os = "macos")]
#[test]
fn macos_hit_classes_register() {
    super::platform::register_classes_for_test();
}

#[test]
fn hit_rect_validation_accepts_finite_positive_rects() {
    assert!(validate_hit_rects(&[OverlayHitRect {
        x: -10.0,
        y: 20.0,
        width: 30.0,
        height: 40.0,
    }])
    .is_ok());
}

#[test]
fn hit_rect_validation_rejects_non_positive_dimensions() {
    assert!(validate_hit_rects(&[OverlayHitRect {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 10.0,
    }])
    .is_err());
}

#[test]
fn hit_rect_validation_rejects_non_finite_values() {
    for invalid in [
        OverlayHitRect {
            x: f64::NAN,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        },
        OverlayHitRect {
            x: 0.0,
            y: f64::INFINITY,
            width: 10.0,
            height: 10.0,
        },
        OverlayHitRect {
            x: 0.0,
            y: 0.0,
            width: f64::NEG_INFINITY,
            height: 10.0,
        },
        OverlayHitRect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: f64::NAN,
        },
    ] {
        assert!(validate_hit_rects(&[invalid]).is_err());
    }
}

#[test]
fn hit_rect_validation_rejects_excessive_count() {
    let rect = OverlayHitRect {
        x: 0.0,
        y: 0.0,
        width: 10.0,
        height: 10.0,
    };
    assert!(validate_hit_rects(&vec![rect; MAX_HIT_RECTS + 1]).is_err());
}
