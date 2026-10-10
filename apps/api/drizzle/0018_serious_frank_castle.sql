CREATE TABLE "library_episode" (
	"title_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"number" integer NOT NULL,
	"added_at" timestamp with time zone,
	"walked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "library_episode_title_id_season_number_pk" PRIMARY KEY("title_id","season","number")
);
--> statement-breakpoint
ALTER TABLE "library_episode" ADD CONSTRAINT "library_episode_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."title"("id") ON DELETE cascade ON UPDATE no action;