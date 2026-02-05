exports.up = function (knex) {
    return knex.schema.alterTable("poller", function (table) {
        table.integer("weight").notNullable().defaultTo(100);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("poller", function (table) {
        table.dropColumn("weight");
    });
};
