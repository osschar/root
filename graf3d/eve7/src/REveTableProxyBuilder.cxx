#include <ROOT/REveTableProxyBuilder.hxx>
#include <ROOT/REveTableInfo.hxx>
#include <ROOT/REveViewContext.hxx>
#include <ROOT/REveDataClasses.hxx>



using namespace ROOT::Experimental;

void REveTableProxyBuilder::Build(const REveDataCollection* collection, REveElement* product, const REveViewContext* context)
   {
      if (!GetHaveAWindow())
         return;

      auto table = new REveDataTable("testTable");
      table->SetCollection(collection);
      product->AddElement(table);

      auto tableEntries =  context->GetTableInfo()->RefTableEntries(collection->GetName());

      for (const REveTableEntry& spec : tableEntries) {
         auto c = new REveDataColumn(spec.fName.c_str());
         table->AddElement(c);
         std::string exp  = "i." + spec.fExpression + "()";
         c->SetExpressionAndType(exp.c_str(), spec.fType);
         c->SetPrecision(spec.fPrecision);
      }

      m_table = table;
   }

void REveTableProxyBuilder::ModelChanges(const REveDataCollection::Ids_t&, REveDataProxyBuilderBase::Product*)
{
   m_table->StampObjProps();
}
