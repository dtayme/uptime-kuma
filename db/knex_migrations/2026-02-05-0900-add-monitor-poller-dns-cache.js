exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.boolean("poller_dns_cache_disabled").notNullable().defaultTo(false);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("poller_dns_cache_disabled");
    });
};
