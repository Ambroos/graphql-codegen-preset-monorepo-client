# GraphQL codegen preset: Monorepo client

Like client-preset, but with support for monorepos sharing a single schema, without duplicated types! Provides a graphql-codegen preset for:

- schema packages: generates all types for your schema only
- feature packages: generates types for the queries and mutations from your feature package, and imports the schema types from the schema package

This is a variant of the [client preset package in the graphql-codegen repository](https://github.com/dotansimha/graphql-code-generator/tree/04d8781ff80b816a5735f86360559e1657108595/packages/presets/client) at the commit linked. fragment-masking-plugin.ts, persisted-documents.ts and process-sources.ts are practically unmodified from the original.

## Installation

Adjust for your favourite package manager.

```bash
npm install --save-dev @ambroos/graphql-codegen-preset-monorepo-client @graphql-codegen/cli
npm install --save graphql
```

## Usage

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
import { featurePreset } from "@ambroos/graphql-codegen-preset-monorepo-client";

const config: CodegenConfig = {
  schema: "../graphql-schema/northcloud-dev.graphql", // adjust for your setup
  documents: ["src/**/*.tsx"],
  generates: {
    "./src/gql/": {
      preset: featurePreset,
      presetConfig: {
        schemaTypesPath: "@myorg/graphql-schema", // if your monorepo uses TypeScript paths (like Nx)
        schemaTypesPath: "../graphql-schema/src/gql", // if your monorepo uses relative paths for imports from another package
      },
    },
  },
};

export default config;
```

### Advanced

Options from the standard @graphql-codegen/client-preset work for the feature preset from this package too.

## Bonus: using with your Nx monorepo

You can use the codegen.ts configurations as shown above, with the following basic graphql-codegen executors.

Add `graphql-codegen` to `cacheableOperations` in your `nx.json` to benefit from Nx caching when your schema/source hasn't changed.

### Nx executors

Create a simple TS project in your workspace, and use the following executors:

**In your schema package**
I recommend using a script to pull your GraphQL schema from your server and plopping it in your schema package. After updating the schema, do a `nx run-many -t graphql-codegen` to rebuild the types for all your packages. You'll need a basic package.json in the directory to make `graphql-codegen` find the codegen.ts config file.

Your schema package has a small `src/index.ts` that contains `export * from './gql'`

```json
{
  "targets": {
    "graphql-codegen": {
      "executor": "nx:run-commands",
      "outputs": ["{projectRoot}/src/gql"],
      "inputs": ["{projectRoot}/*.graphql"],
      "options": {
        "cwd": "{projectRoot}",
        "command": "pnpm exec graphql-codegen --config codegen.ts"
      }
    }
  }
}
```

**In feature packages**
Assuming your schema package lives in `libs/graphql-schema`:

If you use non-standard inputs or your schema lives in a different directory, you'll need to update the `inputs` and `outputs` fields. The setup provided here does the right caching for standard Nx monorepo setups.

```json
{
  "targets": {
    "graphql-codegen": {
      "executor": "nx:run-commands",
      "outputs": ["{projectRoot}/src/gql"],
      "inputs": ["production", "{workspaceRoot}/libs/graphql-schema/*.graphql"],
      "options": {
        "cwd": "{projectRoot}",
        "command": "pnpm exec graphql-codegen --config codegen.ts"
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
