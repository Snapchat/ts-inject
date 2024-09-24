import { dirname, resolve, join } from "path";
import ts from "typescript";

const entryPoint = "src/index.ts";
const outputDir = "./dist/types/preTs5";

/**
 * Generate type declarations for for TypeScript versions below 5.0.
 */
function generatePreTs5Types(typesTsConfigPath: string) {
  const baseDir = resolve(dirname(typesTsConfigPath));
  const configFile = ts.readConfigFile(typesTsConfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`Error reading tsconfig file: ${configFile.error.messageText}`);
  }

  const tsConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, baseDir);
  if (tsConfig.errors.length) {
    throw new Error(`Error parsing tsconfig file: ${tsConfig.errors.map((e) => e.messageText).join(", ")}`);
  }

  // Get the absolute path to the declaration directory (types/default)
  const absPath = tsConfig.options.declarationDir;
  if (!absPath) {
    throw new Error("Declaration directory (declarationDir) is not specified.");
  }

  const compilerOptions = {
    ...tsConfig.options,
    declarationDir: outputDir,
  };

  // Create a TypeScript program with the .d.ts files
  const program = ts.createProgram({
    rootNames: [join(baseDir, entryPoint)],
    options: compilerOptions,
    host: ts.createCompilerHost(compilerOptions),
  });

  const { emitSkipped, diagnostics } = program.emit(
    undefined,
    undefined,
    undefined,
    true, // Emit declarations only
    {
      afterDeclarations: [removeConstFromTypeParameters() as any],
    }
  );

  if (emitSkipped) {
    const formattedDiagnostics = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getCanonicalFileName: (fileName) => fileName,
      getNewLine: () => ts.sys.newLine,
    });
    console.error("Emission of pre TS@5 type declarations failed:\n", formattedDiagnostics);
  }
}

function removeConstFromTypeParameters(): ts.TransformerFactory<ts.SourceFile> {
  return (context: ts.TransformationContext) => {
    const visit: ts.Visitor = (node) => {
      // Check if the node is a type parameter declaration
      if (ts.isTypeParameterDeclaration(node)) {
        // Check if it has a 'const' modifier
        if (node.modifiers && node.modifiers.some((mod) => mod.kind === ts.SyntaxKind.ConstKeyword)) {
          // Remove the 'const' modifier
          const newModifiers = node.modifiers.filter((mod) => mod.kind !== ts.SyntaxKind.ConstKeyword);

          // Create a new TypeParameterDeclaration without 'const'
          const updatedNode = ts.factory.updateTypeParameterDeclaration(
            node,
            newModifiers.length > 0 ? newModifiers : undefined,
            node.name,
            node.constraint,
            node.default
          );

          return ts.visitEachChild(updatedNode, visit, context);
        }
      }

      return ts.visitEachChild(node, visit, context);
    };

    return (node) => ts.visitNode(node, visit) as any;
  };
}

generatePreTs5Types("./tsconfig.types.json");
