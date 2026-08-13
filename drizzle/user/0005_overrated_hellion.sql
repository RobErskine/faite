CREATE TABLE `todo_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`version` integer NOT NULL,
	`todo_id` text,
	`kind` text,
	`at` text,
	`payload` text
);
