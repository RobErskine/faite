PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`workdays_only` integer DEFAULT false NOT NULL,
	`workdays` text DEFAULT '[1,2,3,4,5]' NOT NULL,
	`overflow_after_days` integer DEFAULT 3 NOT NULL,
	`visible_days` integer DEFAULT 7 NOT NULL,
	`visible_statuses` text DEFAULT '["open"]' NOT NULL,
	`visible_event_kinds` text DEFAULT '["created","scheduled","done","dropped"]' NOT NULL,
	`visible_activity_kinds` text DEFAULT '["created","scheduled","unscheduled","moved","done","dropped","reopened","edited","deleted","attached","detached","rolledOver","overflowed"]' NOT NULL,
	`visible_history_kinds` text DEFAULT '["created","scheduled","unscheduled","moved","done","dropped","reopened","edited","deleted","attached","detached","rolledOver","overflowed"]' NOT NULL,
	`hidden_event_kinds` text,
	`hidden_activity_kinds` text,
	`hidden_history_kinds` text,
	`show_weekends` integer DEFAULT true NOT NULL,
	`font_pairing` text NOT NULL,
	`theme` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`avatar_kind` text NOT NULL,
	`avatar_initials` text DEFAULT '' NOT NULL,
	`avatar_emoji` text DEFAULT '' NOT NULL,
	`avatar_image` text DEFAULT '' NOT NULL,
	`active_tab_id` text,
	`backlog_width` integer,
	`backlog_collapsed` integer DEFAULT false NOT NULL,
	`overflow_width` integer,
	`overflow_collapsed` integer DEFAULT false NOT NULL,
	`split_ratio` integer,
	`split_collapsed` text DEFAULT 'none' NOT NULL,
	`reminder_presets_seeded` integer DEFAULT false NOT NULL,
	`overdrive_min_todos` integer DEFAULT 5 NOT NULL,
	`overdrive_auto_confirm_ms` integer DEFAULT 0 NOT NULL,
	`good_job_mode` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_settings`("owner_id", "timezone", "workdays_only", "workdays", "overflow_after_days", "visible_days", "visible_statuses", "visible_event_kinds", "visible_activity_kinds", "visible_history_kinds", "hidden_event_kinds", "hidden_activity_kinds", "hidden_history_kinds", "show_weekends", "font_pairing", "theme", "display_name", "avatar_kind", "avatar_initials", "avatar_emoji", "avatar_image", "active_tab_id", "backlog_width", "backlog_collapsed", "overflow_width", "overflow_collapsed", "split_ratio", "split_collapsed", "reminder_presets_seeded", "overdrive_min_todos", "overdrive_auto_confirm_ms", "good_job_mode", "updated_at", "version") SELECT "owner_id", "timezone", "workdays_only", "workdays", "overflow_after_days", "visible_days", "visible_statuses", "visible_event_kinds", "visible_activity_kinds", "visible_history_kinds", "hidden_event_kinds", "hidden_activity_kinds", "hidden_history_kinds", "show_weekends", "font_pairing", "theme", "display_name", "avatar_kind", "avatar_initials", "avatar_emoji", "avatar_image", "active_tab_id", "backlog_width", "backlog_collapsed", "overflow_width", "overflow_collapsed", "split_ratio", "split_collapsed", "reminder_presets_seeded", "overdrive_min_todos", "overdrive_auto_confirm_ms", "good_job_mode", "updated_at", "version" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;