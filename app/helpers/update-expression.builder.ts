import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { buildExpressionAttributes } from "./expression-attributes";

export type UpdateExpression = {
  UpdateExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, AttributeValue>;
};

export type UpdateExpressionParams<Input> = {
  /**
   * @description Path to the attribute to be updated, this is useful when updating nested attributes.
   * But be careful, this not recommended for deeply nested attributes
   */
  path?: string;
  content: Input;
  /**
   * @description Attribute name to be used as the updated attribute
   * @default 'updated'
   */
  updateAttrName?: string;
};

export class UpdateBuilder<Content extends Record<string, any>> {
  private path: string;
  private content: Content;
  private updateAttrName: string;

  constructor({
    path,
    content,
    updateAttrName = "updatedAt",
  }: UpdateExpressionParams<Content>) {
    this.path = path ?? "";
    this.content = content;
    this.updateAttrName = updateAttrName;
  }

  public expressions(): UpdateExpression {
    const path = this.path ? `${this.path}.` : "";

    const UpdateExpression = Object.keys(this.content)
      .map((key) => `${path}#${key} = :${key}`)
      .toString();

    const { ExpressionAttributeNames, ExpressionAttributeValues } =
      buildExpressionAttributes({
        ...this.content,
        [this.updateAttrName]: new Date().toISOString(),
      });

    return {
      UpdateExpression: `SET ${UpdateExpression}`,
      ExpressionAttributeNames,
      ExpressionAttributeValues: marshall(ExpressionAttributeValues, {
        convertEmptyValues: true,
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      }),
    };
  }
}
