#include <ROOT/REveDataSimpleProxyBuilder.hxx>

// user include files
#include <ROOT/REveDataClasses.hxx>
#include <ROOT/REveCompound.hxx>

using namespace ROOT::Experimental;
namespace REX = ROOT::Experimental;

REveDataSimpleProxyBuilder::REveDataSimpleProxyBuilder()
{
}


REveDataSimpleProxyBuilder::~REveDataSimpleProxyBuilder()
{
}

void
REveDataSimpleProxyBuilder::Clean()
{
   for (Product_it i = m_products.begin(); i != m_products.end(); ++i)
   {
      if ((*i)->m_elements)
      {
         REveElement* elms = (*i)->m_elements;
         for (REveElement::List_i it = elms->BeginChildren(); it != elms->EndChildren(); ++it)
            (*it)->DestroyElements();
      }
   }

   CleanLocal();
}

//______________________________________________________________________________

// AMT: looks like collection parameter is not necessary, maybe for callbacks
void
REveDataSimpleProxyBuilder::Build(const REveDataCollection* collection,
                            REveElementList* product, const REveViewContext* vc)
{
   size_t size = collection->GetNItems();
   REveElement::List_i pIdx = product->BeginChildren();
   for (int index = 0; index < static_cast<int>(size); ++index)
   {
      REveElement* itemHolder = 0;
      if (index <  product->NumChildren())
      {
         itemHolder = *pIdx;
         itemHolder->SetRnrSelfChildren(true, true);
         ++pIdx;
      }
      else
      {
         itemHolder = CreateCompound(true, true);
         itemHolder->SetMainColor(collection->GetMainColor());
         itemHolder->SetElementName(Form("%s %d", collection->GetElementName(), index));
         SetupAddElement(itemHolder, product, true);
      }
      if (Collection()->GetDataItem(index)->GetRnrSelf())
      {
         Build(collection->GetDataPtr(index), itemHolder, vc);
      }
   }
}

//______________________________________________________________________________

bool
REveDataSimpleProxyBuilder::VisibilityModelChanges(int idx, REveElement* iCompound, const REveViewContext* vc)
{
   REveDataItem* item = Collection()->GetDataItem(idx);
   bool returnValue = false;
   if (item->GetRnrSelf() && iCompound->NumChildren()==0)
   {
      Build(item, iCompound, vc);
      returnValue=true;
   }
   return returnValue;
}
