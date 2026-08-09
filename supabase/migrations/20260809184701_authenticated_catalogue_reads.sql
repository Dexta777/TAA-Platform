GRANT SELECT ON public.products TO authenticated;

GRANT SELECT ON public.product_variants TO authenticated;

CREATE POLICY "Authenticated users can view active products" ON public.products
  FOR SELECT
  TO authenticated
  USING ((active = true));

CREATE POLICY "Authenticated users can view active product variants" ON public.product_variants
  FOR SELECT
  TO authenticated
  USING ((active = true));
