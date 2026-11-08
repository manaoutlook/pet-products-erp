import { type ReactNode } from "react";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { RichText } from "@/components/RichText";
import { isHtml } from "@/utils/rich-text";
import BrandQuickAddModal from "@/components/QuickAdd/BrandQuickAddModal";
import { validatePrice, normalizePrice } from "@/utils/price";

export interface BrandOption {
  id: number;
  name: string;
}

export interface CategoryOption {
  id: number;
  name: string;
}

export interface SupplierOption {
  id: number;
  name: string;
  contactInfo?: string | null;
}


// Optional price tiers accept `null` too, because the API returns NULL for
// products that were saved without a value. They are normalised to whole VND
// amounts (no decimals).
const optionalPrice = () =>
  z
    .number()
    .min(0, "Price must be positive")
    .transform((val) => normalizePrice(val))
    .refine(
      (val) => validatePrice(val).isValid,
      (val) => ({ message: validatePrice(val).error || "Invalid price" })
    )
    .nullable()
    .optional();

export const productSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    // Description is optional and the API stores it as NULL when omitted.
    description: z.string().nullable().optional(),
    sku: z.string().min(1, "SKU is required"),
    // NOTE: there is no `price` field anymore - the price tiers below replace it
    // and the API derives the legacy `price` value from them.
    landingPrice: optionalPrice(),
    b2bPrice: optionalPrice(),
    // B2C (retail) price is mandatory; the check lives in the schema-level
    // refinement below so it is reported together with the other fields.
    b2cPrice: optionalPrice(),
    categoryId: z.number().min(1, "Category is required"),
    // Brands are optional: products may be saved without a brand, so `null`
    // (returned by the API for brand-less products) must be accepted too.
    brandId: z.number().nullable().optional(),
    // Supplier is mandatory (every product has to be traceable to a supplier),
    // so an existing supplier id must be picked in the dropdown. `null`/`0` are
    // still accepted by the types because the form starts without a selection.
    supplierId: z.number().nullable().optional(),
    minStock: z.number().int().min(0, "Minimum stock must be positive"),
    // Optional physical attributes. Weight is entered in kilograms (decimals
    // allowed, e.g. 0.35) and the three dimensions in centimetres; `null` means
    // "not specified".
    weightKg: z.number().min(0, "Weight must be positive").nullable().optional(),
    lengthCm: z.number().min(0, "Length must be positive").nullable().optional(),
    widthCm: z.number().min(0, "Width must be positive").nullable().optional(),
    heightCm: z.number().min(0, "Height must be positive").nullable().optional(),
  })
  // Mandatory-field checks are collected in one place so that a missing B2C
  // price and a missing supplier are both reported on the same submit.
  .superRefine((data, ctx) => {
    if (data.b2cPrice === null || data.b2cPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["b2cPrice"],
        message: "B2C price is required",
      });
    }

    if (
      data.supplierId === null ||
      data.supplierId === undefined ||
      data.supplierId <= 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supplierId"],
        message: "Supplier is required",
      });
    }
  });

export type ProductFormData = z.infer<typeof productSchema>;

// Radix Select does not allow an empty string value, so an explicit sentinel
// item is used to clear the (optional) brand selection.
export const NO_BRAND_VALUE = "none";

// Optional price tiers come back from the API as decimal strings (or null), so
// they are converted to numbers for the form.
export function toOptionalPrice(value?: string | number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  return normalizePrice(value);
}

interface ProductFormDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<ProductFormData, any, any>;
  categories?: CategoryOption[];
  brands?: BrandOption[];
  suppliers?: SupplierOption[];
  isPending?: boolean;

  onSubmit: (data: ProductFormData) => void | Promise<void>;
  trigger: ReactNode;
}

/**
 * Shared create/edit product dialog.
 *
 * The fields are laid out as a two-column grid inside a height-capped dialog:
 * the header and the action buttons stay visible while only the fields area
 * scrolls, so every field and the submit button remain reachable on any screen.
 */
export function ProductFormDialog({
  mode,
  open,
  onOpenChange,
  form,
  categories,
  brands,
  suppliers,
  isPending = false,
  onSubmit,
  trigger,
}: ProductFormDialogProps) {
  const isBusy = isPending || form.formState.isSubmitting;

  // Suppliers are shown in a searchable dropdown; the contact info is used as
  // secondary text so suppliers with similar names can still be told apart.
  // The list is sorted alphabetically because the API returns it by updatedAt.
  const supplierOptions = [...(suppliers ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((supplier) => ({
      value: supplier.id.toString(),
      label: supplier.name,
      description: supplier.contactInfo ?? null,
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{mode === "create" ? "Add New Product" : "Edit Product"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sku"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>SKU</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={field.value ?? ""}
                          rows={4}
                          placeholder="Plain text or HTML, e.g. <p><strong>450 g</strong> aluminium body</p>"
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Accepts plain text or HTML. Line breaks are kept for plain text and
                        HTML is rendered (sanitised) on the product details page.
                      </p>
                      {/* Live preview so authors can check pasted HTML looks right. */}
                      {field.value?.trim() ? (
                        <div className="mt-1 rounded-md border bg-muted/40 p-3">
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            Preview{isHtml(field.value) ? " (HTML)" : ""}
                          </p>
                          <RichText value={field.value} />
                        </div>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Category</FormLabel>
                      <Select
                        value={field.value ? field.value.toString() : ""}
                        onValueChange={(value) => field.onChange(parseInt(value, 10))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories?.map((category) => (
                            <SelectItem
                              key={category.id}
                              value={category.id.toString()}
                            >
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="brandId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Brand</FormLabel>
                      <div className="flex gap-2">
                        <Select
                          value={field.value != null ? field.value.toString() : NO_BRAND_VALUE}
                          onValueChange={(value) =>
                            field.onChange(value === NO_BRAND_VALUE ? null : parseInt(value, 10))
                          }
                        >
                          <FormControl>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select a brand" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NO_BRAND_VALUE}>No brand</SelectItem>
                            {brands?.map((brand) => (
                              <SelectItem
                                key={brand.id}
                                value={brand.id.toString()}
                              >
                                {brand.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <BrandQuickAddModal
                          onSuccess={(brand) => {
                            // Set the newly created brand as the selected brand
                            field.onChange(brand.id);
                          }}
                          trigger={
                            <Button type="button" variant="outline" size="icon">
                              <Plus className="h-4 w-4" />
                            </Button>
                          }
                        />
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Supplier</FormLabel>
                      <FormControl>
                        {/* Supplier is mandatory, so there is no "clear" entry:
                            picking another supplier replaces the current one. */}
                        <SearchableSelect
                          options={supplierOptions}
                          value={field.value != null && field.value > 0 ? field.value.toString() : null}
                          onChange={(value) => field.onChange(value === null ? null : parseInt(value, 10))}
                          onBlur={field.onBlur}
                          placeholder="Select a supplier"
                          searchPlaceholder="Search suppliers..."
                          emptyMessage="No supplier found."
                          disabled={isBusy}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="minStock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Stock</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value === "" ? 0 : parseInt(e.target.value, 10))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Optional physical attributes: weight (kg) + L/W/H (cm) */}
                <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-4">
                  <FormField
                    control={form.control}
                    name="weightKg"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Weight (kg)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            step="0.001"
                            placeholder="Kilograms"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === "" ? null : parseFloat(e.target.value)
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lengthCm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Length (cm)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Optional"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === "" ? null : parseFloat(e.target.value)
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="widthCm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Width (cm)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Optional"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === "" ? null : parseFloat(e.target.value)
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="heightCm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Height (cm)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Optional"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === "" ? null : parseFloat(e.target.value)
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {/* Optional price tiers */}
                <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="landingPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Landing Price</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Optional"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(e.target.value === "" ? null : parseFloat(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="b2bPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>B2B Price</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Optional"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(e.target.value === "" ? null : parseFloat(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="b2cPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>B2C Price</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Required"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(e.target.value === "" ? null : parseFloat(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-background px-6 py-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button variant={mode === "create" ? "create" : "update"} type="submit" disabled={isBusy}>
                {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === "create" ? "Create Product" : "Update Product"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default ProductFormDialog;
