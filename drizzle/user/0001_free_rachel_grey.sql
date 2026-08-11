ALTER TABLE `settings` ADD `visible_statuses` text DEFAULT '["open"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `show_weekends` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `backlog_width` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `backlog_collapsed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `overflow_width` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `overflow_collapsed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `split_ratio` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `split_collapsed` text DEFAULT 'none' NOT NULL;