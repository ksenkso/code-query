import * as parser from '@babel/parser';
import traverseAst from '@babel/traverse';
import vueParser from 'vue-eslint-parser';

export const parseModule = source => parser.parse(source, {
  sourceType: 'module'
});

export const traverse = (source, options) => {
  const ast = parseModule(source);

  traverseAst.default(ast, options)
}

export const subtraverse = (ast, options) => {
  traverseAst.default(ast, {
    noScope: true,
    ...options,
  });
}

export const getJsFromVue = (vueFileContent) => {
  const program = vueParser.parse(vueFileContent, {
    sourceType: 'module',
    ecmaVersion: 'latest',
  });
  const start = program.body.at(0)?.start;
  const end = program.body.at(-1)?.end;

  if (start === undefined || end === undefined) {
    return '';
  }

  return vueFileContent.substring(start, end);
}


export const getComponentOption = (exportDeclaration, optionName) => {
  return exportDeclaration.declaration.properties.find(prop => prop.key.name === optionName);
}

export const isPropertyName = (name) => (prop) => prop.key && prop.key.name === name;

export  const getLastExpression = (functionExpression) => {
  return functionExpression.body.body.at(-1);
}
