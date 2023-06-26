import { allJsFromVueFiles, logSet } from '../utils.mjs';
import { getComponentOption, getLastExpression, isPropertyName, traverse } from '../selection.mjs';
import t from '@babel/types';

export const findAsyncDataAndIsLoading = async () => {
  const duplicateDeclarations = new Set();

  for await (const { name, jsSource } of allJsFromVueFiles()) {
    traverse(jsSource, {
      ExportDefaultDeclaration(path) {
        const { node } = path;
        const setupNode = node.declaration.properties.find(prop => prop.key.name === 'setup');
        if (setupNode) {
          const lastSetupStatement = setupNode.body.body.at(-1);

          const returnsUseAsyncData = t.isReturnStatement(lastSetupStatement)
            && t.isCallExpression(lastSetupStatement.argument)
            && lastSetupStatement.argument.callee.name === 'useAsyncData';
          if (returnsUseAsyncData) {
            let hasDuplicateDeclaration = false;
            const dataOption = getComponentOption(node, 'data');
            if (dataOption) {
              hasDuplicateDeclaration = !!getLastExpression(dataOption).argument.properties.find(isPropertyName('isLoading'));
            }

            if (!hasDuplicateDeclaration) {
              const computedOption = getComponentOption(node, 'computed');
              if (computedOption) {
                hasDuplicateDeclaration = !!computedOption.value.properties.find(isPropertyName('isLoading'));
              }
            }

            if (hasDuplicateDeclaration) {
              duplicateDeclarations.add(name);
            }
          }
        }
      }
    });
  }

  console.log('Double declarations of `isLoading`:');
  logSet(duplicateDeclarations);
};
