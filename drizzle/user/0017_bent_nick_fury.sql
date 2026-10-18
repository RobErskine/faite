CREATE TABLE `assignees` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text,
	`color` text,
	`instructions` text,
	`api_key_id` text
);
--> statement-breakpoint
ALTER TABLE `todos` ADD `assignee_id` text;--> statement-breakpoint
ALTER TABLE `todos` ADD `done_criteria` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `todos` ADD `access` text;