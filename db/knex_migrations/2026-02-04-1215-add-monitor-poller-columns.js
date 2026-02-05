exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.string("poller_mode", 20).nullable();
        table.integer("poller_id").unsigned().nullable();
        table.string("poller_region", 100).nullable();
        table.string("poller_datacenter", 100).nullable();
        table.string("poller_capability", 100).nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("poller_mode");
        table.dropColumn("poller_id");
        table.dropColumn("poller_region");
        table.dropColumn("poller_datacenter");
        table.dropColumn("poller_capability");
    });
};
