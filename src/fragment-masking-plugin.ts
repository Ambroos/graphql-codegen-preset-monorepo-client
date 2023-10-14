import type { PluginFunction } from "@graphql-codegen/plugin-helpers";

const fragmentTypeHelper = `
export type FragmentType<TDocumentType extends DocumentTypeDecoration<any, any>> = TDocumentType extends DocumentTypeDecoration<
  infer TType,
  any
>
  ? [TType] extends [{ ' $fragmentName'?: infer TKey }]
    ? TKey extends string
      ? { ' $fragmentRefs'?: { [key in TKey]: TType } }
      : never
    : never
  : never;`;

const makeFragmentDataHelper = `
export function makeFragmentData<
  F extends DocumentTypeDecoration<any, any>,
  FT extends ResultOf<F>
>(data: FT, _fragment: F): FragmentType<F> {
  return data as FragmentType<F>;
}`;

const defaultUnmaskFunctionName = "getFragmentData";

const modifyType = (
  rawType: string,
  opts: {
    nullable: boolean;
    list: "with-list" | "only-list" | false;
    empty?: boolean;
  },
) => {
  return `${
    opts.list === "only-list"
      ? `ReadonlyArray<${rawType}>`
      : opts.list === "with-list"
      ? `${rawType} | ReadonlyArray<${rawType}>`
      : rawType
  }${opts.nullable ? " | null | undefined" : ""}`;
};

const createUnmaskFunctionTypeDefinition = (
  unmaskFunctionName = defaultUnmaskFunctionName,
  opts: { nullable: boolean; list: "with-list" | "only-list" | false },
) => {
  return `export function ${unmaskFunctionName}<TType>(
  _documentNode: DocumentTypeDecoration<TType, any>,
  fragmentType: ${modifyType(
    `FragmentType<DocumentTypeDecoration<TType, any>>`,
    opts,
  )}
): ${modifyType("TType", opts)}`;
};

const createUnmaskFunctionTypeDefinitions = (
  unmaskFunctionName = defaultUnmaskFunctionName,
) => [
  `// return non-nullable if \`fragmentType\` is non-nullable\n${createUnmaskFunctionTypeDefinition(
    unmaskFunctionName,
    { nullable: false, list: false },
  )}`,
  `// return nullable if \`fragmentType\` is nullable\n${createUnmaskFunctionTypeDefinition(
    unmaskFunctionName,
    {
      nullable: true,
      list: false,
    },
  )}`,
  `// return array of non-nullable if \`fragmentType\` is array of non-nullable\n${createUnmaskFunctionTypeDefinition(
    unmaskFunctionName,
    { nullable: false, list: "only-list" },
  )}`,
  `// return array of nullable if \`fragmentType\` is array of nullable\n${createUnmaskFunctionTypeDefinition(
    unmaskFunctionName,
    { nullable: true, list: "only-list" },
  )}`,
];

const createUnmaskFunction = (
  unmaskFunctionName = defaultUnmaskFunctionName,
) => `
${createUnmaskFunctionTypeDefinitions(unmaskFunctionName)
  .concat(
    createUnmaskFunctionTypeDefinition(unmaskFunctionName, {
      nullable: true,
      list: "with-list",
    }),
  )
  .join(";\n")} {
  return fragmentType as any;
}
`;

const isFragmentReadyFunction = (isStringDocumentMode: boolean) => {
  if (isStringDocumentMode) {
    return `\
export function isFragmentReady<TQuery, TFrag>(
  queryNode: TypedDocumentString<TQuery, any>,
  fragmentNode: TypedDocumentString<TFrag, any>,
  data: FragmentType<TypedDocumentString<Incremental<TFrag>, any>> | null | undefined
): data is FragmentType<typeof fragmentNode> {
  const deferredFields = queryNode.__meta__?.deferredFields as Record<string, (keyof TFrag)[]>;
  const fragName = fragmentNode.__meta__?.fragmentName as string | undefined;

  if (!deferredFields || !fragName) return true;

  const fields = deferredFields[fragName] ?? [];
  return fields.length > 0 && fields.every(field => data && field in data);
}
`;
  }
  return `\
export function isFragmentReady<TQuery, TFrag>(
  queryNode: DocumentTypeDecoration<TQuery, any>,
  fragmentNode: TypedDocumentNode<TFrag>,
  data: FragmentType<TypedDocumentNode<Incremental<TFrag>, any>> | null | undefined
): data is FragmentType<typeof fragmentNode> {
  const deferredFields = (queryNode as { __meta__?: { deferredFields: Record<string, (keyof TFrag)[]> } }).__meta__
    ?.deferredFields;

  if (!deferredFields) return true;

  const fragDef = fragmentNode.definitions[0] as FragmentDefinitionNode | undefined;
  const fragName = fragDef?.name?.value;

  const fields = (fragName && deferredFields[fragName]) || [];
  return fields.length > 0 && fields.every(field => data && field in data);
}
`;
};

/**
 * Plugin for generating fragment masking helper functions.
 */
export const plugin: PluginFunction<{
  schemaTypesPath: string;
  augmentedModuleName?: string;
  unmaskFunctionName?: string;
  isStringDocumentMode?: boolean;
}> = (
  _,
  __,
  {
    schemaTypesPath,
    augmentedModuleName,
    unmaskFunctionName,
    isStringDocumentMode,
  },
  _info,
) => {
  if (schemaTypesPath == null || schemaTypesPath === "") {
    throw new Error(
      "[monorepo-client packagePreset] schemaTypesPath is required - if you don't want to use split schemas, use @graphql-codegen/client-preset instead",
    );
  }

  const documentNodeImport = `import type { ResultOf, DocumentTypeDecoration${
    isStringDocumentMode ? "" : ", TypedDocumentNode"
  } } from '@graphql-typed-document-node/core';\n`;

  const deferFragmentHelperIncrementalImports = `import type { Incremental } from '${schemaTypesPath}';\n`;

  const deferFragmentHelperImports = isStringDocumentMode
    ? `import type { TypedDocumentString } from './graphql';\n`
    : "";

  const fragmentDefinitionNodeImport = isStringDocumentMode
    ? ""
    : `import type { FragmentDefinitionNode } from 'graphql';\n`;

  if (augmentedModuleName == null) {
    return [
      "/* eslint-disable */\n",
      documentNodeImport,
      fragmentDefinitionNodeImport,
      deferFragmentHelperIncrementalImports,
      deferFragmentHelperImports,
      `\n`,
      fragmentTypeHelper,
      `\n`,
      createUnmaskFunction(unmaskFunctionName),
      `\n`,
      makeFragmentDataHelper,
      `\n`,
      isFragmentReadyFunction(isStringDocumentMode ?? false),
    ].join(``);
  }

  return [
    documentNodeImport,
    `declare module "${augmentedModuleName}" {`,
    [
      ...fragmentTypeHelper.split(`\n`),
      `\n`,
      ...createUnmaskFunctionTypeDefinitions(unmaskFunctionName)
        .join("\n")
        .split("\n"),
      `\n`,
      makeFragmentDataHelper,
    ]
      .map((line) => (line === `\n` || line === "" ? line : `  ${line}`))
      .join(`\n`),
    `}`,
  ].join(`\n`);
};
