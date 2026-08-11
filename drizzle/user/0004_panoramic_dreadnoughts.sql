CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`google_place_id` text,
	`lat` real,
	`lng` real
);
--> statement-breakpoint
ALTER TABLE `todos` ADD `place_id` text;