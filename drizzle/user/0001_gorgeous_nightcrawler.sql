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
ALTER TABLE `settings` ADD `visible_statuses` text DEFAULT '["open"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `show_weekends` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `backlog_width` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `backlog_collapsed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `overflow_width` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `overflow_collapsed` integer DEFAULT false NOT NULL;