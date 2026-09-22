CREATE TABLE "collection_part" (
	"collection_id" integer NOT NULL,
	"tmdb_id" text NOT NULL,
	"name" text NOT NULL,
	"year" integer,
	"release_date" date,
	"poster_path" text,
	CONSTRAINT "collection_part_collection_id_tmdb_id_pk" PRIMARY KEY("collection_id","tmdb_id")
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"tmdb_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "title" ADD COLUMN "director" text;--> statement-breakpoint
ALTER TABLE "title" ADD COLUMN "top_cast" jsonb;--> statement-breakpoint
ALTER TABLE "title" ADD COLUMN "collection_id" integer;--> statement-breakpoint
ALTER TABLE "collection_part" ADD CONSTRAINT "collection_part_collection_id_collection_tmdb_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("tmdb_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title" ADD CONSTRAINT "title_collection_id_collection_tmdb_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("tmdb_id") ON DELETE no action ON UPDATE no action;