CREATE TABLE `day_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`date` text NOT NULL,
	`body` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `visible_event_kinds` text DEFAULT '["created","scheduled","done","dropped"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `todos` ADD `scheduled_at` text;