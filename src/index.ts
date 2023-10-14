import * as addPlugin from "@graphql-codegen/add";
import * as gqlTagPlugin from "@graphql-codegen/gql-tag-operations";
import type { PluginFunction, Types } from "@graphql-codegen/plugin-helpers";
import * as typedDocumentNodePlugin from "@graphql-codegen/typed-document-node";
import * as typescriptPlugin from "@graphql-codegen/typescript";
import * as typescriptOperationPlugin from "@graphql-codegen/typescript-operations";
import {
  ClientSideBaseVisitor,
  DocumentMode,
} from "@graphql-codegen/visitor-plugin-common";
import { DocumentNode } from "graphql";
import * as fragmentMaskingPlugin from "./fragment-masking-plugin.js";
import {
  generateDocumentHash,
  normalizeAndPrintDocumentNode,
} from "./persisted-documents.js";
import { processSources } from "./process-sources.js";

export type FragmentMaskingConfig = {
  /** @description Name of the function that should be used for unmasking a masked fragment property.
   * @default `'useFragment'`
   */
  unmaskFunctionName?: string;
};

type ClientPresetConfig = {
  /**
   * @description Fragment masking hides data from components and only allows accessing the data by using a unmasking function.
   * @exampleMarkdown
   * ```tsx
   * const config = {
   *    schema: 'https://swapi-graphql.netlify.app/.netlify/functions/index',
   *    documents: ['src/**\/*.tsx', '!src\/gql/**\/*'],
   *    generates: {
   *       './src/gql/': {
   *          preset: 'client',
   *          presetConfig: {
   *            fragmentMasking: false,
   *          }
   *        },
   *    },
   * };
   * export default config;
   * ```
   */
  fragmentMasking?: FragmentMaskingConfig | boolean;
  /**
   * @description Specify the name of the "graphql tag" function to use
   * @default "graphql"
   *
   * E.g. `graphql` or `gql`.
   *
   * @exampleMarkdown
   * ```tsx
   * const config = {
   *    schema: 'https://swapi-graphql.netlify.app/.netlify/functions/index',
   *    documents: ['src/**\/*.tsx', '!src\/gql/**\/*'],
   *    generates: {
   *       './src/gql/': {
   *          preset: 'client',
   *          presetConfig: {
   *            gqlTagName: 'gql',
   *          }
   *        },
   *    },
   * };
   * export default config;
   * ```
   */
  gqlTagName?: string;
  /**
   * Generate metadata for a executable document node and embed it in the emitted code.
   */
  onExecutableDocumentNode?: (
    documentNode: DocumentNode,
  ) => void | Record<string, unknown>;
  /** Persisted operations configuration. */
  persistedDocuments?:
    | boolean
    | {
        /**
         * @description Behavior for the output file.
         * @default 'embedHashInDocument'
         * "embedHashInDocument" will add a property within the `DocumentNode` with the hash of the operation.
         * "replaceDocumentWithHash" will fully drop the document definition.
         */
        mode?: "embedHashInDocument" | "replaceDocumentWithHash";
        /**
         * @description Name of the property that will be added to the `DocumentNode` with the hash of the operation.
         */
        hashPropertyName?: string;
        /**
         * @description Algorithm used to generate the hash, could be useful if your server expects something specific (e.g., Apollo Server expects `sha256`).
         *
         * The algorithm parameter is typed with known algorithms and as a string rather than a union because it solely depends on Crypto's algorithms supported
         * by the version of OpenSSL on the platform.
         *
         * @default `sha1`
         */
        hashAlgorithm?: "sha1" | "sha256" | (string & {});
      };
};

export type packagePresetConfig = ClientPresetConfig & {
  /**
   * @description Package of or path to the file that exports the schema types (and is built with schemaPreset).
   * @exampleMarkdown
   * ```tsx
   * const config = {
   *    schema: '../graphql-schema/schema.graphql',
   *    documents: ['src/**\/*.tsx', '!src\/gql/**\/*'],
   *    generates: {
   *       './src/gql/': {
   *          preset: packagePreset,
   *          presetConfig: {
   *            schemaTypesPath: '@mymonorepo/graphql-schema',
   *            // or
   *            schemaTypesPath: '../graphql-schema/schemaTypes.ts',
   *          }
   *        },
   *    },
   * };
   * export default config;
   */
  schemaTypesPath?: string;
};

export type SchemaPresetConfig = {};

const isOutputFolderLike = (baseOutputDir: string) =>
  baseOutputDir.endsWith("/");

export const packagePreset: Types.OutputPreset<packagePresetConfig> = {
  prepareDocuments: (outputFilePath, outputSpecificDocuments) => [
    ...outputSpecificDocuments,
    `!${outputFilePath}`,
  ],
  buildGeneratesSection: (options) => {
    const schemaTypesPath = options.presetConfig.schemaTypesPath;
    if (schemaTypesPath == null || schemaTypesPath === "") {
      throw new Error(
        "[monorepo-client featurePreset] schemaTypesPath is required - if you don't want to use split schemas, use @graphql-codegen/client-preset instead",
      );
    }

    if (!isOutputFolderLike(options.baseOutputDir)) {
      throw new Error(
        '[monorepo-client featurePreset] target output should be a directory, ex: "src/gql/". Make sure you add "/" at the end of the directory path',
      );
    }

    if (
      options.plugins.length > 0 &&
      Object.keys(options.plugins).some((p) => p.startsWith("typescript"))
    ) {
      throw new Error(
        '[monorepo-client presets] providing typescript-based `plugins` with `preset: "client" leads to duplicated generated types',
      );
    }

    const isPersistedOperations =
      !!options.presetConfig?.persistedDocuments ?? false;

    const reexports: Array<string> = [];

    // the `client` preset is restricting the config options inherited from `typescript`, `typescript-operations` and others.
    const forwardedConfig = {
      scalars: options.config.scalars,
      defaultScalarType: options.config.defaultScalarType,
      strictScalars: options.config.strictScalars,
      namingConvention: options.config.namingConvention,
      skipTypename: options.config.skipTypename,
      arrayInputCoercion: options.config.arrayInputCoercion,
      enumsAsTypes: options.config.enumsAsTypes,
      futureProofEnums: options.config.futureProofEnums,
      dedupeFragments: options.config.dedupeFragments,
      nonOptionalTypename: options.config.nonOptionalTypename,
      avoidOptionals: options.config.avoidOptionals,
      documentMode: options.config.documentMode,
    };

    const visitor = new ClientSideBaseVisitor(
      options.schemaAst!,
      [],
      options.config,
      options.config,
    );
    let fragmentMaskingConfig: FragmentMaskingConfig | null = null;

    if (typeof options?.presetConfig?.fragmentMasking === "object") {
      fragmentMaskingConfig = options.presetConfig.fragmentMasking;
    } else if (options?.presetConfig?.fragmentMasking !== false) {
      // `true` by default
      fragmentMaskingConfig = {};
    }

    const onExecutableDocumentNodeHook =
      options.presetConfig.onExecutableDocumentNode ?? null;
    const isMaskingFragments = fragmentMaskingConfig != null;

    const persistedDocuments = options.presetConfig.persistedDocuments
      ? {
          hashPropertyName:
            (typeof options.presetConfig.persistedDocuments === "object" &&
              options.presetConfig.persistedDocuments.hashPropertyName) ||
            "hash",
          omitDefinitions:
            (typeof options.presetConfig.persistedDocuments === "object" &&
              options.presetConfig.persistedDocuments.mode) ===
              "replaceDocumentWithHash" || false,
          hashAlgorithm:
            (typeof options.presetConfig.persistedDocuments === "object" &&
              options.presetConfig.persistedDocuments.hashAlgorithm) ||
            "sha1",
        }
      : null;

    const sourcesWithOperations = processSources(options.documents, (node) => {
      if (node.kind === "FragmentDefinition") {
        return visitor.getFragmentVariableName(node);
      }
      return visitor.getOperationVariableName(node);
    });
    const sources = sourcesWithOperations.map(({ source }) => source);

    const tdnFinished = createDeferred();
    const persistedDocumentsMap = new Map<string, string>();

    const pluginMap = {
      ...options.pluginMap,
      [`add`]: addPlugin,
      [`typescript-operations`]: typescriptOperationPlugin,
      [`typed-document-node`]: {
        ...typedDocumentNodePlugin,
        plugin: async (...args: Parameters<PluginFunction>) => {
          try {
            return await typedDocumentNodePlugin.plugin(...args);
          } finally {
            tdnFinished.resolve();
          }
        },
      },
      [`gen-dts`]: gqlTagPlugin,
    };

    function onExecutableDocumentNode(documentNode: DocumentNode) {
      const meta = onExecutableDocumentNodeHook?.(documentNode);

      if (persistedDocuments) {
        const documentString = normalizeAndPrintDocumentNode(documentNode);
        const hash = generateDocumentHash(
          documentString,
          persistedDocuments.hashAlgorithm,
        );
        persistedDocumentsMap.set(hash, documentString);
        return { ...meta, [persistedDocuments.hashPropertyName]: hash };
      }

      if (meta) {
        return meta;
      }

      return undefined;
    }

    const plugins: Array<Types.ConfiguredPlugin> = [
      { [`add`]: { content: `/* eslint-disable */` } },
      {
        [`add`]: {
          content: `import * as schema from '${schemaTypesPath}'`,
        },
      },
      {
        [`typescript-operations`]: {
          namespacedImportName: "schema",
        },
      },
      {
        [`typed-document-node`]: {
          unstable_onExecutableDocumentNode: onExecutableDocumentNode,
          unstable_omitDefinitions:
            persistedDocuments?.omitDefinitions ?? false,
        },
      },
      ...options.plugins,
    ];

    const genDtsPlugins: Array<Types.ConfiguredPlugin> = [
      { [`add`]: { content: `/* eslint-disable */` } },
      { [`gen-dts`]: { sourcesWithOperations } },
    ];

    reexports.push("gql");

    const config = {
      ...options.config,
      useTypeImports: true,
      inlineFragmentTypes: isMaskingFragments
        ? "mask"
        : options.config["inlineFragmentTypes"],
    };

    let fragmentMaskingFileGenerateConfig: Types.GenerateOptions | null = null;

    if (isMaskingFragments === true) {
      reexports.push("fragment-masking");

      fragmentMaskingFileGenerateConfig = {
        filename: `${options.baseOutputDir}fragment-masking.ts`,
        pluginMap: {
          [`fragment-masking`]: fragmentMaskingPlugin,
        },
        plugins: [
          {
            [`fragment-masking`]: {
              schemaTypesPath,
            },
          },
        ],
        schema: options.schema,
        config: {
          unmaskFunctionName: fragmentMaskingConfig?.unmaskFunctionName,
          isStringDocumentMode:
            options.config.documentMode === DocumentMode.string,
        },
        documents: [],
        documentTransforms: options.documentTransforms,
      };
    }

    const output: Types.GenerateOptions[] = [
      {
        filename: `${options.baseOutputDir}graphql.ts`,
        plugins,
        pluginMap,
        schema: options.schema,
        config: {
          immutableTypes: true,
          useTypeImports: true,
          inlineFragmentTypes: isMaskingFragments
            ? "mask"
            : options.config["inlineFragmentTypes"],
          ...forwardedConfig,
        },
        documents: sources,
        documentTransforms: options.documentTransforms,
      },
      {
        filename: `${options.baseOutputDir}gql.ts`,
        plugins: genDtsPlugins,
        pluginMap,
        schema: options.schema,
        config: {
          ...config,
          useTypeImports: true,
          gqlTagName: options.presetConfig.gqlTagName || "graphql",
        },
        documents: sources,
        documentTransforms: options.documentTransforms,
      },
      ...(isPersistedOperations
        ? [
            {
              filename: `${options.baseOutputDir}persisted-documents.json`,
              plugins: [
                {
                  [`persisted-operations`]: {},
                },
              ],
              pluginMap: {
                [`persisted-operations`]: {
                  plugin: async () => {
                    await tdnFinished.promise;
                    return {
                      content: JSON.stringify(
                        Object.fromEntries(persistedDocumentsMap.entries()),
                        null,
                        2,
                      ),
                    };
                  },
                },
              },
              schema: options.schema,
              config: {},
              documents: sources,
              documentTransforms: options.documentTransforms,
            },
          ]
        : []),
      ...(fragmentMaskingFileGenerateConfig
        ? [fragmentMaskingFileGenerateConfig]
        : []),
      {
        filename: `${options.baseOutputDir}index.ts`,
        pluginMap: {
          [`add`]: addPlugin,
        },
        plugins: [
          {
            [`add`]: {
              content: reexports
                .sort()
                .map((moduleName) => `export * from "./${moduleName}";`)
                .join("\n"),
            },
          },
        ],
        schema: options.schema,
        config: {},
        documents: [],
        documentTransforms: options.documentTransforms,
      },
    ];

    return output;
  },
};

export const schemaPreset: Types.OutputPreset<SchemaPresetConfig> = {
  prepareDocuments: (outputFilePath, outputSpecificDocuments) => [
    ...outputSpecificDocuments,
    `!${outputFilePath}`,
  ],
  buildGeneratesSection: (options) => {
    if (!isOutputFolderLike(options.baseOutputDir)) {
      throw new Error(
        '[monorepo-client schemaPreset] target output should be a directory, ex: "src/gql/". Make sure you add "/" at the end of the directory path',
      );
    }

    if (
      options.plugins.length > 0 &&
      Object.keys(options.plugins).some((p) => p.startsWith("typescript"))
    ) {
      throw new Error(
        '[monorepo-client presets] providing typescript-based `plugins` with `preset: "client" leads to duplicated generated types',
      );
    }

    // the `client` preset is restricting the config options inherited from `typescript`, `typescript-operations` and others.
    const forwardedConfig = {
      scalars: options.config.scalars,
      defaultScalarType: options.config.defaultScalarType,
      strictScalars: options.config.strictScalars,
      namingConvention: options.config.namingConvention,
      useTypeImports: options.config.useTypeImports,
      skipTypename: options.config.skipTypename,
      arrayInputCoercion: options.config.arrayInputCoercion,
      enumsAsTypes: options.config.enumsAsTypes ?? true,
      futureProofEnums: options.config.futureProofEnums ?? true,
      dedupeFragments: options.config.dedupeFragments,
      nonOptionalTypename: options.config.nonOptionalTypename,
      avoidOptionals: options.config.avoidOptionals,
      documentMode: options.config.documentMode,
    };

    const pluginMap = {
      ...options.pluginMap,
      [`add`]: addPlugin,
      [`typescript`]: typescriptPlugin,
    };

    return [
      {
        filename: `${options.baseOutputDir}schemaTypes.ts`,
        plugins: [{ [`typescript`]: {} }],
        pluginMap,
        schema: options.schema,
        config: {
          onlyOperationTypes: true,
          ...forwardedConfig,
        },
        documents: [],
        documentTransforms: options.documentTransforms,
      },
    ];
  },
};

type Deferred<T = void> = {
  resolve: (value: T) => void;
  reject: (value: unknown) => void;
  promise: Promise<T>;
};

function createDeferred<T = void>(): Deferred<T> {
  const d = {} as Deferred<T>;
  d.promise = new Promise<T>((resolve, reject) => {
    d.resolve = resolve;
    d.reject = reject;
  });
  return d;
}
