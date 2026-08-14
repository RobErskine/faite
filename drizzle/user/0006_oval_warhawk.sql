CREATE TABLE `reminder_presets` (
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
	`time` text NOT NULL,
	`position` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `reminder_presets_seeded` integer DEFAULT false NOT NULL;