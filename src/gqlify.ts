import {
  BaseTypePlugin,
  WhereInputPlugin,
  QueryPlugin,
  CreatePlugin,
  UpdatePlugin,
  DeletePlugin,
} from './plugins';
import { createRelation, Model } from './dataModel';
import { parse } from './parse';
import { MODEL_DIRECTIVE, MODEL_DIRECTIVE_SOURCE_NAME } from './constants';
import { omit, forEach } from 'lodash';
import Generator from './generator';
import { createRelationHooks } from './hooks/relationHook';
import mergeHooks from './hooks/mergeHooks';
import combine from './resolver/combine';
import { DataSource } from './dataSource/interface';
import { IResolvers } from 'graphql-tools';
import gql from 'graphql-tag';

export class Gqlify {
  private sdl: string;
  private dataSources: Record<string, (args: any) => DataSource>;

  constructor({
    sdl,
    dataSources,
  }: {
    sdl: string,
    dataSources: Record<string, (args: any) => DataSource>,
  }) {
    this.sdl = sdl;
    this.dataSources = dataSources;
  }

  public createServerConfig(): {typeDefs: string, resolvers: IResolvers} {
    const {rootNode, models} = parse(this.sdl);
    const modelMap: Record<string, Model> = {};

    // bind dataSource
    models.forEach(model => {
      // make it easy to accsss later
      modelMap[model.getName()] = model;

      // constuct data source
      const dataSourceArgs = model.getMetadata(MODEL_DIRECTIVE);
      const dataSourceIdentifier: string = dataSourceArgs[MODEL_DIRECTIVE_SOURCE_NAME];
      const createDataSource: (args: any) => DataSource = this.dataSources[dataSourceIdentifier];
      if (!createDataSource) {
        throw new Error(`dataSource ${dataSourceIdentifier} does not exist`);
      }
      const args = omit(dataSourceArgs, MODEL_DIRECTIVE_SOURCE_NAME);
      const dataSource = createDataSource(args);

      // set to model
      model.setDataSource(dataSource);
    });

    // create relation hooks
    const relations = createRelation(models);
    const relationHooks = createRelationHooks(relations);

    // merge hooks
    const hookMap = mergeHooks(relationHooks);

    // initialize plugins
    const plugins = [
      new BaseTypePlugin(),
      new WhereInputPlugin(),
      new QueryPlugin(),
      new CreatePlugin({hook: hookMap}),
      new UpdatePlugin({hook: hookMap}),
      new DeletePlugin({hook: hookMap}),
    ];

    // set resolver from hook
    forEach(hookMap, (hook, key) => {
      if (!modelMap[key]) {
        throw new Error(`model ${key} not found for hooks`);
      }
      modelMap[key].overrideResolver(hook.resolveFields);
    });

    const generator = new Generator({ plugins, rootNode });
    const resolvers = combine(plugins, models);
    const typeDefs = generator.generate(models);

    return {
      typeDefs,
      resolvers,
    };
  }

  public createApolloConfig() {
    const serverConfig = this.createServerConfig();
    return {
      ...serverConfig,
      typeDefs: gql(serverConfig.typeDefs),
    };
  }
}