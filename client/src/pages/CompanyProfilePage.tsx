import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, Building2, Loader2, RefreshCw, RotateCcw, Save } from "lucide-react";
import { COMPANY_FIELDS, missingCompanyFields, type CompanyFieldKey } from "@shared/company";
import { useCompanyInfo, COMPANY_QUERY_KEY } from "@/hooks/use-company";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CompanyHeaderPreview } from "@/components/company/CompanyHeader";

/**
 * Company Profile - the one screen that writes the letterhead.
 *
 * The four fields here are the four fields printed on every document and shown in the
 * screen header; they are not copied, they come from `COMPANY_FIELDS`. Saving invalidates
 * `["/api/company"]`, so the band at the top of the screen updates in the same tick as the
 * form - there is no second copy of the company name anywhere in the app.
 */

const labelFor = (key: CompanyFieldKey) =>
  COMPANY_FIELDS.find((field) => field.key === key)?.label ?? key;

const companyProfileSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "Company name is required")
    .max(200, "Company name must be 200 characters or fewer"),
  registeredAddress: z
    .string()
    .trim()
    .min(1, "Registered address is required")
    .max(500, "Registered address must be 500 characters or fewer"),
  deliveryAddress: z
    .string()
    .trim()
    .min(1, "Delivery address is required")
    .max(500, "Delivery address must be 500 characters or fewer"),
  taxId: z
    .string()
    .trim()
    .min(1, "Tax ID is required")
    .max(50, "Tax ID must be 50 characters or fewer"),
});

type CompanyProfileValues = z.infer<typeof companyProfileSchema>;

const EMPTY_VALUES: CompanyProfileValues = {
  companyName: "",
  registeredAddress: "",
  deliveryAddress: "",
  taxId: "",
};

function CompanyProfilePage() {
  const { company, isLoading, isError, error, refetch, missingFields } = useCompanyInfo();
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canUpdate = hasPermission("masterData", "update");

  const form = useForm<CompanyProfileValues>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: EMPTY_VALUES,
  });

  // Seed the form from the saved row (and re-seed if the header refreshes).
  useEffect(() => {
    if (company) {
      form.reset(company);
    }
  }, [company, form]);

  const saveCompanyProfile = useMutation({
    mutationFn: async (values: CompanyProfileValues) => {
      const response = await fetch("/api/company", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Failed to save company information");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_QUERY_KEY });
      toast({
        title: "Company information saved",
        description: "Every document and the screen header now use this letterhead.",
        variant: "success",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not save company information",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const previewValues = form.watch();
  const previewMissing = missingCompanyFields(previewValues);

  return (
    <div className="erp-page">
      <div className="erp-page-header">
        <div>
          <h1 className="erp-page-title">Company Profile</h1>
          <p className="erp-page-subtitle">
            The letterhead printed on sales orders, delivery notes, receipts and purchase
            orders - and shown at the top of every screen.
          </p>
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not load the company letterhead</AlertTitle>
          <AlertDescription>
            <p>
              {error instanceof Error && error.message
                ? error.message
                : "The server did not return the company profile."}
            </p>
            <p className="mt-1">
              Nothing is shown as saved until this loads - a blank form here does not mean
              the letterhead is blank.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        missingFields.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Document header incomplete</AlertTitle>
            <AlertDescription>
              Missing: {missingFields.join(", ")}. Printing is blocked until every field is
              filled in.
            </AlertDescription>
          </Alert>
        )
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Letterhead details
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading company information...
              </div>
            ) : (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((values) => saveCompanyProfile.mutate(values))}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{labelFor("companyName")}</FormLabel>
                        <FormControl>
                          <Input placeholder="Pet Products Trading Co., Ltd." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="registeredAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{labelFor("registeredAddress")}</FormLabel>
                        <FormControl>
                          <Textarea rows={2} placeholder="Head office address" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="deliveryAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{labelFor("deliveryAddress")}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={2}
                            placeholder="Warehouse / delivery address"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="taxId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{labelFor("taxId")}</FormLabel>
                        <FormControl>
                          <Input placeholder="Tax / VAT registration number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => form.reset(company ?? EMPTY_VALUES)}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reset
                    </Button>
                    <Button
                      type="submit"
                      variant="create"
                      disabled={!canUpdate || saveCompanyProfile.isPending}
                    >
                      {saveCompanyProfile.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save Company Profile
                    </Button>
                  </div>

                  {!canUpdate && (
                    <p className="text-caption text-muted-foreground">
                      You can view the letterhead but need master-data update permission to
                      change it.
                    </p>
                  )}
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Document header preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CompanyHeaderPreview company={previewValues} />
            <p className="text-caption text-muted-foreground">
              {previewMissing.length === 0
                ? "Complete - this is what every printed document opens with."
                : `Missing: ${previewMissing.join(
                    ", "
                  )}. Print actions stay blocked until the profile is saved.`}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default CompanyProfilePage;
