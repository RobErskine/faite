CREATE TABLE `email_ingest` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`local_part` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`window_start` integer,
	`window_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_ingest_local_part_unique` ON `email_ingest` (`local_part`);--> statement-breakpoint
CREATE INDEX `email_ingest_user_id_idx` ON `email_ingest` (`user_id`);