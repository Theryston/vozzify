CREATE INDEX "private_tracks_processing_queue_idx" ON "private_tracks" USING btree ("processing_status","updated_at","id");
