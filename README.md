# GraphQL codegen preset: Monorepo client

Like client-preset, but more opinionated and with support for monorepos sharing a single schema, without duplicated types! Provides a graphql-codegen preset for:

- schema packages: generates types for shared schema types only (enums, scalars and operation inputs)
- feature packages: generates types for the queries and mutations from your feature package, and imports the schema types from the schema package

This is a variant of the [client preset package in the graphql-codegen repository](https://github.com/dotansimha/graphql-code-generator/tree/04d8781ff80b816a5735f86360559e1657108595/packages/presets/client) at the commit linked. fragment-masking-plugin.ts, persisted-documents.ts and process-sources.ts are practically unmodified from the original.

**Sample repository using this preset in an Nx monorepo: [ambroos/sample-monorepo-graphql-codegen-project](https://github.com/ambroos/sample-monorepo-graphql-codegen-project)**

## Installation

Adjust for your favourite package manager.

```bash
npm install --save-dev @ambroos/graphql-codegen-preset-monorepo-client @graphql-codegen/cli
npm install --save graphql
```

## Codegen setup

### Schema package

Create a `codegen.ts` file in your schema package with the following content, adjust paths.

```typescript
import { CodegenConfig } from "@graphql-codegen/cli";
import { schemaPreset } from "@ambroos/graphql-codegen-preset-monorepo-client";

const config: CodegenConfig = {
  schema: "./schema.graphql",
  generates: {
    "./src/gql/": {
      preset: schemaPreset,
      // no presetConfig available for schemaPreset
    },
  },
};

export default config;
```

### Feature package

Another `codegen.ts`, this time referencing where your schema package lives with `schemaTypesPath`. As long as what you put in `schemaTypesPath` works in this package in the sense of import \* as types from '${schemaTypesPath}', you're good to go.

```typescript
import { CodegenConfig } from "@graphql-codegen/cli";
import { packagePreset } from "@ambroos/graphql-codegen-preset-monorepo-client";

const config: CodegenConfig = {
  schema: "../graphql-schema/schema.graphql", // adjust for your setup
  documents: ["src/**/*.tsx"],
  generates: {
    "./src/gql/": {
      preset: packagePreset,
      presetConfig: {
        // use this if your monorepo uses TypeScript paths (like Nx)
        schemaTypesPath: "@myorg/graphql-schema",
        // or, if your monorepo uses relative paths for imports from another package
        schemaTypesPath: "../graphql-schema/src/gql",
      },
    },
  },
};

export default config;
```

### More configuration

Many options from the standard @graphql-codegen/client-preset work for the feature preset from this package too. A few of them are set up by default:

- schema: onlyOperationTypes is forced to true, since query/mutation types are generated for packages, full schema types are not needed. (If you need full schema types, just use `plugin: 'typescript'` to generate index.ts in your config instead of using schemaPreset - the package preset will still work.)
- schema: enumsAsTypes and futureProofEnums are turned on by default, purely because I like them.
- package: useTypeImports is forced on, there are no downsides AFAIK but please raise an issue if you disagree
- package: immutableTypes is forced on, because you should not mutate your GraphQL data if you use fragments, since components downstream would also see the mutated data and not have any control about it
- package: unmask function is renamed to `getFragmentData`

## In code

[Follow the "Writing GraphQL Queries" and "Writing GraphQL Fragments" guides from the GraphQL Codegen guide.](https://the-guild.dev/graphql/codegen/docs/guides/react-vue#writing-graphql-queries) **Note** that this preset uses `getFragmentData` instead of `useFragment` to get the data from a fragment.

## Advanced topics

### Optimizing bundles

The output is quite large because it includes strings for every GraphQL string twice, once in your source, once in generated code, along with an object representation of your query. To reduce this to only the object representation [you can use the Babel plugin or SWC plugin from the client preset](https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size).

If you get a build error when adding the SWC plugin, you likely are on a newer version of SWC than the plugin supports. [This fork of the SWC plugin is more up-to-date.](https://www.npmjs.com/package/@victorandree/graphql-codegen-client-preset-swc-plugin)

Example Vite config:

`npm install --save-dev @victorandree/graphql-codegen-client-preset-swc-plugin`

```typescript
import react from '@vitejs/plugin-react-swc'

// ... other things
export default defineConfig({
  plugins: [
    react({
      plugins: [
        [
          '@victorandree/graphql-codegen-client-preset-swc-plugin',
          { artifactDirectory: './src/gql', gqlTagName: 'graphql' },
        ],
      ],
    }),
//...
```

## Bonus: using with your Nx monorepo

You can use the codegen.ts configurations as shown above, with the following basic graphql-codegen executors. Update the paths to be relative to your repo root.

Add `graphql-codegen` to `cacheableOperations` in your `nx.json` to benefit from Nx caching when your schema/source hasn't changed.

### Nx executors

Create a simple TS project in your workspace, and use the following executors:

**In your schema package**
I recommend using a script to pull your GraphQL schema from your server and plopping it in your schema package. After updating the schema, do a `nx run-many -t graphql-codegen` to rebuild the types for all your packages.

Your schema package has a small `src/index.ts` that contains `export * from './gql'`

```json
{
  "targets": {
    "graphql-codegen": {
      "executor": "nx:run-commands",
      "outputs": ["{projectRoot}/src/gql"],
      "inputs": ["{projectRoot}/*.graphql", "{projectRoot}/codegen.ts"],
      "options": {
        "command": "npx graphql-codegen --config {projectRoot}/codegen.ts"
      }
    }
  }
}
```

**In feature/other packages**
Assuming your schema package lives in `libs/graphql-schema`:

If you use non-standard inputs or your schema lives in a different directory, you'll need to update the `inputs` and `outputs` fields. The setup provided here does the right caching for standard Nx monorepo setups.

```json
{
  "targets": {
    "graphql-codegen": {
      "executor": "nx:run-commands",
      "outputs": ["{projectRoot}/src/gql"],
      "inputs": [
        "production",
        "{projectRoot}/codegen.ts",
        "{workspaceRoot}/libs/graphql-schema/*.graphql"
      ],
      "options": {
        "command": "npx graphql-codegen --config {projectRoot}/codegen.ts"
      }
    }
  }
}
```

### Nx generator to fetch a schema

Only needs `@nx/devkit` and `graphql` as dependencies. Add your own auth to the `getIntrospectionSchema` function.

```typescript
import { Tree } from "@nx/devkit";
import { FetchGraphqlSchemaGeneratorSchema } from "./schema";
import { readFile } from "fs/promises";
import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql";

async function getIntrospectionSchema(token) {
  return fetch("https://api.example.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  })
    .then((res) => {
      if (res.ok) {
        return res;
      }
      throw new Error(`Failed to fetch schema: ${res.statusText}`);
    })
    .then((res) => res.json())
    .then((res) => {
      if (res.errors != null && res.errors.length > 0) {
        throw new Error(
          `Failed to fetch schema: ${res.errors
            .map((e) => e.message)
            .join(", ")}`,
        );
      }
      const schema = buildClientSchema(res.data);
      return printSchema(schema);
    });
}

export async function fetchGraphqlSchemaGenerator(
  tree: Tree,
  options: FetchGraphqlSchemaGeneratorSchema,
) {
  const token = options.token;

  if (token == null) {
    console.error(
      "No token provided, please provide the right authentication to fetch your schema.",
    );
    throw new Error();
  }

  const introspectionSchema = await getIntrospectionSchema(token);

  tree.write("libs/graphql-schema/schema.graphql", introspectionSchema);

  console.log("✅ Schema is ready! You should now rerun your GraphQL codegen.");
}

export default fetchGraphqlSchemaGenerator;
```
