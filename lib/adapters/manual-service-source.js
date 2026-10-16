/** Service proposal source contract: getProposals(context) -> service suggestions.
 * An independent service-table or PB adapter can be injected later.
 * Quotes keep their own priced service snapshot and have no runtime PB dependency.
 */
export const manualServiceSource = Object.freeze({
  async getProposals() { return []; },
});

export function blankManualService(number) {
  return { name: `Service ${number}`, description: "", price: "", taxMode: "inclusive" };
}
