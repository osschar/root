#include <ROOT/REveTableInfo.hxx>

using namespace ROOT::Experimental;

void REveTableViewInfo::SetDisplayedCollection(std::string collectionName)
{
   fDisplayedCollection = collectionName;
   _handler_func(this);
}
