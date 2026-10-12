ALTER TABLE `settings` ADD `smart_sort_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `todos` ADD `suggested_list_id` text;