export type ExpressionAttributes = {
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, string>;
};

/**
 *
 * @param payload  - The payload to be used to build the expression attributes
 * @example - buildExpressionAttributes<{ name: string }>({ name: "John" })
 */
export const buildExpressionAttributes = <T extends Record<string, any>>(
  payload: T
): ExpressionAttributes =>
  Object.keys(payload).reduce(
    (acc, attribute) => {
      const ExpressionAttributeNames = {
        ...acc.ExpressionAttributeNames,
        [`#${attribute}`]: attribute,
      };

      const ExpressionAttributeValues = {
        ...acc.ExpressionAttributeValues,
        [`:${attribute}`]: payload[attribute],
      };

      return { ExpressionAttributeNames, ExpressionAttributeValues };
    },
    {
      ExpressionAttributeNames: {},
      ExpressionAttributeValues: {},
    }
  );
