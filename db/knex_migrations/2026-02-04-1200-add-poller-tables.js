exports.up = function (knex) {
    return knex.schema
        .createTable("poller", function (table) {
            table.increments("id");
            table.string("name", 255).notNullable();
            table.string("region", 100).notNullable();
            table.string("datacenter", 100);
            table.text("capabilities");
            table.string("version", 100);
            table.string("status", 20).notNullable().defaultTo("offline");
            table.integer("queue_depth").notNullable().defaultTo(0);
            table.integer("assignment_version").notNullable().defaultTo(0);
            table.datetime("last_heartbeat_at");
            table.datetime("last_assignment_pull_at");
            table.datetime("last_results_at");
            table.datetime("created_at").notNullable().defaultTo(knex.fn.now());
            table.datetime("updated_at").notNullable().defaultTo(knex.fn.now());
        })
        .createTable("poller_token", function (table) {
            table.increments("id");
            table.integer("poller_id").unsigned().notNullable();
            table.string("hashed_token", 128).notNullable();
            table.boolean("active").notNullable().defaultTo(true);
            table.datetime("created_at").notNullable().defaultTo(knex.fn.now());
            table.datetime("expires_at");
            table.datetime("last_used_at");

            table.index(["poller_id"], "poller_token_poller_id");
            table.index(["hashed_token"], "poller_token_hashed_token");
        });
};

exports.down = function (knex) {
    return knex.schema.dropTable("poller_token").dropTable("poller");
};
