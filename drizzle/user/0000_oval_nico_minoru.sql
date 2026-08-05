CREATE TABLE `field_clocks` (
	`entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`field` text NOT NULL,
	`hlc` text NOT NULL,
	PRIMARY KEY(`entity_id`, `field`)
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`color` text,
	`emoji` text,
	`icon_url` text,
	`name` text NOT NULL,
	`position` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`color` text,
	`emoji` text,
	`icon_url` text,
	`name` text NOT NULL,
	`is_backlog` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`archived_with_tab_id` text,
	`position` text NOT NULL,
	`tab_id` text
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`color` text,
	`emoji` text,
	`icon_url` text,
	`name` text NOT NULL,
	`position` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`workdays_only` integer DEFAULT false NOT NULL,
	`workdays` text DEFAULT '[1,2,3,4,5]' NOT NULL,
	`overflow_after_days` integer DEFAULT 3 NOT NULL,
	`visible_days` integer DEFAULT 7 NOT NULL,
	`font_pairing` text NOT NULL,
	`theme` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`avatar_kind` text NOT NULL,
	`avatar_initials` text DEFAULT '' NOT NULL,
	`avatar_emoji` text DEFAULT '' NOT NULL,
	`avatar_image` text DEFAULT '' NOT NULL,
	`active_tab_id` text,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`next_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`color` text,
	`emoji` text,
	`icon_url` text,
	`name` text NOT NULL,
	`description` text,
	`is_default` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`position` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` integer,
	`scheduled_date` text,
	`deadline` text,
	`list_id` text,
	`project_id` text,
	`label_ids` text DEFAULT '[]' NOT NULL,
	`location` text,
	`parent_id` text,
	`position` text NOT NULL,
	`recurrence_rule` text,
	`recurrence_parent_id` text,
	`completed_at` text
);
