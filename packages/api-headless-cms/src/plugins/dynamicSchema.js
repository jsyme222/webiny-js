import pluralize from "pluralize";
import gql from "graphql-tag";
import * as resolve from "@webiny/commodo-graphql";
import { createTypeName, createManageTypeName, createReadTypeName } from "../utils/createTypeName";
import { resolveGet } from "../utils/resolveGet";
import { resolveList } from "../utils/resolveList";
import { resolveCreate } from "../utils/resolveCreate";
import { resolveUpdate } from "../utils/resolveUpdate";
import TypeValueEmitter from "../utils/TypeValueEmitter";

const commonFieldResolvers = () => ({
    id: entry => (entry._id ? entry._id.toString() : null),
    createdBy: entry => {
        return { __typename: "SecurityUser", id: entry.createdBy };
    },
    updatedBy: entry => {
        return { __typename: "SecurityUser", id: entry.createdBy };
    }
});

export default async ({ context }) => {
    const { plugins } = context;

    // Structure plugins for faster access
    const fieldTypePlugins = plugins.byType("cms-field-type").reduce((acc, pl) => {
        acc[pl.fieldType] = pl;
        return acc;
    }, {});

    // Load model data

    const { CmsContentModel } = context.models;

    const models = await CmsContentModel.find();

    const modelPlugins = {};

    function renderFields(model, type) {
        return model.fields
            .map(f => {
                return fieldTypePlugins[f.type][type].createTypeField({ model, field: f });
            })
            .join("\n");
    }

    function renderFieldsFromPlugins(model, type) {
        const plugins = modelPlugins[model.modelId];

        return plugins.map(pl => pl[type].createTypeField({ model })).join("\n");
    }

    function renderInputFields(model) {
        return model.fields
            .map(f => {
                return fieldTypePlugins[f.type].manage.createInputField({ model, field: f });
            })
            .join("\n");
    }

    function renderListFilterFields(model, type) {
        return model.fields
            .map(field => {
                const { createListFilters } = fieldTypePlugins[field.type][type];
                if (typeof createListFilters === "function") {
                    return createListFilters({ field });
                }
            })
            .filter(Boolean)
            .join("\n");
    }

    function renderTypesFromPlugins(model, type) {
        return modelPlugins[model.modelId]
            .map(pl => {
                // Render gql types generated by field type plugins
                if (typeof pl[type].createTypes === "function") {
                    return pl[type].createTypes({ model, models });
                }
                return "";
            })
            .join("\n");
    }

    function renderSortEnum(model) {
        const sorters = [];
        model.fields
            .filter(f => fieldTypePlugins[f.type].isSortable)
            .forEach(f => {
                sorters.push(`${f.fieldId}_ASC`);
                sorters.push(`${f.fieldId}_DESC`);
            });

        return sorters.join("\n");
    }

    const newPlugins = [];

    models.forEach(model => {
        const typeName = createTypeName(model.modelId);
        const mTypeName = createManageTypeName(typeName);
        const rTypeName = createReadTypeName(typeName);

        // Get model plugins
        modelPlugins[model.modelId] = plugins
            .byType("cms-model-field")
            .filter(pl => pl.modelId === model.modelId);

        // Create a schema plugin for each model (Management Schema)
        newPlugins.push({
            name: "graphql-schema-" + model.modelId + "-manage",
            type: "graphql-schema",
            schema: {
                typeDefs: gql`
                    "${model.description}"
                    type ${mTypeName} {
                        id: ID
                        createdBy: SecurityUser
                        updatedBy: SecurityUser
                        createdOn: DateTime
                        updatedOn: DateTime
                        savedOn: DateTime
                        ${renderFields(model, "manage")}
                    }
                    
                    input ${mTypeName}Input {
                        ${renderInputFields(model, "manage")}
                    }
                    
                    input ${mTypeName}FilterInput {
                        id: ID
                        id_not: ID
                        id_in: [ID]
                        id_not_in: [ID]
                        ${renderListFilterFields(model, "manage")}
                    }
                    
                    type ${mTypeName}Response {
                        data: ${mTypeName}
                        error: CmsError
                    }
                    
                    type ${mTypeName}ListResponse {
                        data: [${mTypeName}]
                        meta: CmsListMeta
                        error: CmsError
                    }
                    
                    extend type CmsManageQuery {
                        get${typeName}(id: ID, locale: String): ${mTypeName}Response
                        
                        list${pluralize(typeName)}(
                            locale: String
                            page: Int
                            perPage: Int
                            sort: JSON
                            where: ${mTypeName}FilterInput
                        ): ${mTypeName}ListResponse
                    }
                    
                    extend type CmsManageMutation{
                        create${typeName}(data: ${mTypeName}Input!): ${mTypeName}Response
                        update${typeName}(id: ID!, data: ${mTypeName}Input!): ${mTypeName}Response
                        delete${typeName}(id: ID!): CmsDeleteResponse
                    }
                `,
                resolvers: {
                    Query: {
                        cmsManage: {
                            resolve: (parent, args, context) => {
                                context.cmsManage = true;
                                return {};
                            }
                        }
                    },
                    Mutation: {
                        cmsManage: resolve.emptyResolver
                    },
                    CmsManageQuery: {
                        [`get${typeName}`]: resolveGet({ models, model }),
                        [`list${pluralize(typeName)}`]: resolveList({ models, model })
                    },
                    CmsManageMutation: {
                        [`create${typeName}`]: resolveCreate({ models, model }),
                        [`update${typeName}`]: resolveUpdate({ models, model }),
                        [`delete${typeName}`]: resolve.emptyResolver
                    },
                    [mTypeName]: model.fields.reduce((resolvers, field) => {
                        const { manage } = fieldTypePlugins[field.type];
                        let resolver = (entry, args, ctx, info) => entry[info.fieldName];
                        if (typeof manage.createResolver === "function") {
                            resolver = manage.createResolver({ models, model, field });
                        }

                        resolvers[field.fieldId] = (entry, args, ctx, info) => {
                            return resolver(entry, args, ctx, info);
                        };

                        return resolvers;
                    }, commonFieldResolvers())
                }
            }
        });

        // Create a schema plugin for each model (Read-Only Schema)
        newPlugins.push({
            name: "graphql-schema-" + model.modelId + "-read",
            type: "graphql-schema",
            schema: {
                typeDefs: gql`
                    ${renderTypesFromPlugins(model, "read")}
                        
                    "${model.description}"
                    type ${rTypeName} {
                        id: ID
                        createdBy: SecurityUser
                        updatedBy: SecurityUser
                        createdOn: DateTime
                        updatedOn: DateTime
                        savedOn: DateTime
                        ${renderFields(model, "read")}
                        ${renderFieldsFromPlugins(model, "read")}
                    }
                    
                    input ${rTypeName}FilterInput {
                        id: ID
                        id_not: ID
                        id_in: [ID]
                        id_not_in: [ID]
                        ${renderListFilterFields(model, "read")}
                    }
                    
                    enum ${rTypeName}Sorter {
                        createdOn_ASC
                        createdOn_DESC
                        updatedOn_ASC
                        updatedOn_DESC
                        ${renderSortEnum(model, "read")}
                    }
                    
                    type ${rTypeName}Response {
                        data: ${rTypeName}
                        error: CmsError
                    }
                    
                    type ${rTypeName}ListResponse {
                        data: [${rTypeName}]
                        meta: CmsListMeta
                        error: CmsError
                    }
                    
                    extend type CmsReadQuery {
                        get${typeName}(locale: String, where: ${rTypeName}FilterInput, sort: [${rTypeName}Sorter]): ${rTypeName}Response
    
                        list${pluralize(typeName)}(
                            locale: String
                            page: Int
                            perPage: Int
                            where: ${rTypeName}FilterInput
                            sort: [${rTypeName}Sorter]
                        ): ${rTypeName}ListResponse
                    }
                `,
                resolvers: {
                    Query: {
                        cmsRead: {
                            resolve: (parent, args, context) => {
                                /**
                                 * Create emitter for resolved values.
                                 * It is used in model field plugins to access values from sibling resolvers.
                                 */
                                context.resolvedValues = new TypeValueEmitter();
                                return {};
                            }
                        }
                    },
                    CmsReadQuery: {
                        [`get${typeName}`]: resolveGet({ model }),
                        [`list${pluralize(typeName)}`]: resolveList({ model })
                    },
                    [rTypeName]: model.fields.reduce((resolvers, field) => {
                        const { read } = fieldTypePlugins[field.type];
                        const resolver = read.createResolver({ models, model, field });

                        resolvers[field.fieldId] = (entry, args, ctx, info) => {
                            const value = resolver(entry, args, ctx, info);

                            const cacheKey = `${model.modelId}:${entry._id}:${field.fieldId}`;
                            ctx.resolvedValues.set(cacheKey, value);
                            return value;
                        };

                        modelPlugins[model.modelId].forEach(pl => {
                            resolvers[pl.fieldId] = pl.read.createResolver();
                        });

                        return resolvers;
                    }, commonFieldResolvers())
                }
            }
        });
    });

    plugins.register(newPlugins);
};
