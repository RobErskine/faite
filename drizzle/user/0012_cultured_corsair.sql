CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`todo_id` text,
	`filename` text,
	`mime_type` text,
	`byte_size` integer,
	`storage_key` text,
	`swept_at` text
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `visible_activity_kinds` text DEFAULT '["created","scheduled","unscheduled","moved","done","dropped","reopened","edited","deleted","rolledOver","overflowed"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `good_job_mode` integer DEFAULT false NOT NULL;